---
title: "Things I noticed while using an AI agent for everyday tasks"
date: 2026-02-27T20:00:00-08:00
tags:
- ai
- automation
- openclaw
- raspberry pi
featured_image: ""
description: "Observations from letting an AI agent handle photo culling, playlist management, and a pet insurance claim."
---

I set up [OpenClaw](https://github.com/openclaw/openclaw) on a Raspberry Pi 5 in [my media closet](/posts/media-closet/), connected it to Discord, and pointed it at my other machines. It runs on the Pi for lightweight stuff and can delegate to a Hyper-V VM or my MacBook when it needs more compute.

I gave it three things I'd been putting off. They all got done, but the interesting part was what I noticed along the way.

<!-- TODO: photo of the Pi in the media closet, maybe with a Discord notification on screen -->

## Photo culling without a single API call

I shoot birds with a Sony α6700. A typical session produces 100-200 photos, most of which are duplicates or near-misses. I asked the agent to build something that could automatically pick the keepers.

The obvious approach is sending photos to a vision model for quality scoring. That works, but it's slow and costs money per image. The agent went a different direction entirely: it found that **Apple Photos already runs ML models on every photo in your library**. Sharpness, composition, subject interest, lighting, bokeh quality, clutter detection, all scored and stored locally. You can read all of it through [osxphotos](https://github.com/RhetTbull/osxphotos), a Python library for querying the Photos database. No cloud API, no GPU, no model inference. The scores are just sitting there, already computed, for every photo you've ever taken.

That discovery short-circuited the entire project. Instead of building an expensive vision pipeline, we could just do math on existing data.

<!-- TODO: screenshot of osxphotos score fields for a sample photo showing all the ML dimensions -->

### Optimizing the weights

We tested on 203 photos from a Super Bowl party (Sony α6700, Viltrox 75mm f/1.2). I'd already manually culled these down to 80 keepers, so we had ground truth to train against.

The pipeline clusters similar shots by perceptual fingerprint distance, detected people overlap, and timestamps, then keeps the best per cluster based on a composite quality score. The optimization was finding the right weights for each of Apple's ML fields.

Here's what the grid search settled on:

| Score field | Weight | What it means |
|---|---|---|
| `tastefully_blurred` | 0.922 | Bokeh quality |
| `well_chosen_subject` | 0.828 | Good subject selection |
| `well_framed_subject` | 0.680 | Framing/composition |
| `pleasant_lighting` | 0.607 | Lighting quality |
| `overall` | 0.550 | Apple's combined score |
| `interesting_subject` | 0.514 | Subject interest |
| `well_timed_shot` | 0.479 | Timing |
| `pleasant_composition` | 0.460 | Composition |
| `sharply_focused_subject` | 0.254 | Focus (kind of) |
| `intrusive_object_presence` | -0.966 | Clutter penalty |

A few things jump out. `tastefully_blurred` and `well_chosen_subject` dominate, which makes sense for event photos shot on a fast prime: the best shots tend to be the ones where someone is well-separated from the background with clean bokeh. `intrusive_object_presence` gets the strongest negative weight, heavily penalizing cluttered frames.

And then there's `sharply_focused_subject` at a surprisingly low 0.254. We found out the hard way that this score doesn't measure actual focus accuracy. It measures depth-of-field separation. A completely misfocused shot at f/1.2 can score high because the background blur is dramatic. The optimization correctly figured out this field is unreliable and downweighted it.

The weights also tell a story about my preferences. Heavy on bokeh and subject isolation, low tolerance for clutter. That tracks.

<!-- TODO: side-by-side of a high sharply_focused_subject misfocused f/1.2 shot vs a genuinely sharp one -->

### Results

**87.2% agreement** with my manual decisions (F1: 0.841). Not perfect, but the remaining ~13% error is mostly stuff no ML model can measure: "only shot of this person at the event," "blurry but funny expression," "technically mediocre but I like it." The plan is to run a vision model on just the borderline photos to close the gap, maybe 30-40 images instead of 203.

The fields `curation`, `noise`, and `fail` turned out to be useless for culling (almost zero variance across all photos). And `interesting_subject` showed the biggest delta between the top 20 and bottom 20 photos (+0.92), making it the single most predictive field for good-vs-bad.

<!-- TODO: the agent's message in #photos about discovering Apple ML scores, showing the "wait, they're already scored?" moment -->

## Apple Music Automix playlists

I've been maintaining two DJ-style playlists on Apple Music since last summer, when Apple introduced Automix (crossfade between tracks). The concept: order songs by [Camelot key](https://mixedinkey.com/camelot-wheel/) so adjacent tracks are harmonically compatible, and match BPMs so the crossfade doesn't sound jarring.

Getting there is painful. For each new song:

1. Look up its BPM and Camelot key (usually on [Tunebat](https://tunebat.com/))
2. Find the right version in Apple Music's catalog
3. Add it to the playlist
4. Tag the metadata: BPM in the native field, Camelot key in the Grouping field (Apple Music doesn't expose key/BPM data through its API, so I store it manually)
5. Drag it into position based on its Camelot key
6. Listen to the two new transitions (the songs before and after it)
7. If a transition doesn't sound right, move the song and listen to the transitions at the new position, plus the new transition at the gap you left behind
8. Repeat until it fits

That last part is the killer. Moving one song creates three new transitions to evaluate: two at the destination, one at the source. If those don't work either, you're suddenly five transitions deep. I spent dozens of hours on this when I first built the playlists.

The agent can't help with the listening and repositioning yet (that's a taste problem). But it automated steps 1-4 completely. It set up MusicKit API auth on my Mac, built a workflow around catalog search and playlist endpoints, looked up Camelot keys on Tunebat via browser automation, and handled the AppleScript metadata tagging. I asked it to add five songs and it handled all of them end to end.

The process now: I say "add [song] to BB2" in Discord and it does the lookup, catalog match, playlist add, and metadata tag. Five songs that would have taken 25+ minutes of tab-switching took a few minutes of back-and-forth.

<!-- TODO: screenshot of the playlist in Music app showing the Grouping/BPM metadata columns -->

## Filing a pet insurance claim

Our cat Lexie is going through oncology treatment, and I needed to file a claim on Nationwide's pet insurance portal. I sent the agent the invoice PDF and medical record and told it to file the claim.

Nationwide's portal is an Angular app, and it fought the agent at every step.

**Form fields** ignored typed input. The agent had to call native DOM value setters in JavaScript and manually fire `input` and `change` events to get Angular's change detection to notice.

**The terms checkbox** unchecked itself when clicked normally. Buttons visible in the page DOM didn't respond to click events. Everything had to go through JavaScript `evaluate` calls.

But the file upload was the real adventure. The standard browser upload API reported success but attached nothing. Clicking the upload button opened a native OS file dialog that froze the browser tab entirely. After several failed approaches, the agent's solution was:

1. Copy the PDF to the VM ✓ (normal)
2. **Start a CORS-enabled HTTP server on the VM** (less normal)
3. `fetch()` the PDF from within the page context, construct a `File` object via the `DataTransfer` API, and inject it into the file input

Step 2 is where I lost it. The agent had to stand up a web server to upload a file. But it worked. Angular's change detection picked up the injected file, and the upload went through.

<!-- TODO: screenshot of the skill file showing "Step 2: Start CORS HTTP server on VM", or the Discord exchange about it -->

The checkbox `.click()` would *uncheck* itself. Buttons with visible refs wouldn't respond to clicks. The file input ignored the standard upload protocol entirely. If someone was using a screen reader on that site, I'd feel for them.

The whole interaction is now saved as a reusable skill, so the next claim is just "here's the invoice" and done.

## The pattern

The thing that surprised me most wasn't any individual task. It was how each one followed the same arc: I described the problem, the agent tried the obvious approach, hit something unexpected, and that unexpected thing turned out to be the most interesting part. Apple Photos already scoring every image. Angular fighting its own UI. A local web server as a file upload workaround.

The agent writes everything it learns to memory files that persist across sessions. The photo culling weights, the Angular workarounds, the MusicKit auth flow. Next time it wakes up, it reads those files and picks up where it left off.

For photos, the next step is refining the weights on bird photography (different genre, different scoring priorities) and running a vision model pass on just the borderline shots. For playlists, the dream is automating the transition-listening loop, but that's a harder problem. For insurance claims, hopefully we just don't need too many of those.

<!-- TODO: closing photo of the media closet, or a diagram of Pi + VM + MacBook setup -->
