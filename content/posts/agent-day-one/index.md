---
title: "What my AI agent did on its first day"
date: 2026-02-27T20:00:00-08:00
tags:
- ai
- automation
- openclaw
- raspberry pi
featured_image: ""
description: "Photo culling, playlist management, and pet insurance claims, all from a Raspberry Pi in my closet."
---

I gave an AI agent access to my machines and told it to be useful. Here's what happened.

## The setup

I've been running [OpenClaw](https://github.com/openclaw/openclaw) on a Raspberry Pi 5 that lives in [my media closet](/posts/media-closet/). It connects to Discord as a bot, and I can optionally connect other machines as "nodes" for heavier compute. Right now it talks to my Pi (always on, lightweight tasks), my MacBook (when it's around), and a Hyper-V VM on my desktop PC (the muscle). The agent has a persistent workspace with memory files it reads every session, so it builds context over time even though each conversation starts fresh.

The whole thing came online on February 26th. By the end of February 27th, it had done three genuinely useful things I would have otherwise spent my evening on.

## 1. Photo culling with Apple's built-in ML

I shoot birds with a Sony α6700 and end up with 100-200 photos per session. Reviewing them all is tedious. I wanted the agent to build an automated culling pipeline.

The clever part: instead of sending every photo to a vision API (expensive, slow), the agent discovered that Apple Photos already scores every image with ML models for sharpness, composition, interesting subject, lighting, and more. These scores are accessible through [osxphotos](https://github.com/RhetTbull/osxphotos). So the pipeline:

1. Export photo metadata via osxphotos (no pixels leave the machine)
2. Compute a composite quality score from Apple's ML fields
3. Cluster similar shots using perceptual fingerprint distance + person overlap + time proximity
4. Keep the best per cluster, favorite them in Photos

We tested it on 203 photos from a Super Bowl party and hit 87% agreement with my manual cull decisions. Zero API calls, zero cost. The biggest lesson was that Apple's `sharply_focused_subject` score measures depth-of-field, not actual focus, so fast lenses like my Viltrox 75mm f/1.2 fool it. The agent documented this and tuned the weights accordingly.

## 2. Apple Music playlist management

I maintain two DJ-style playlists where songs are ordered by [Camelot key](https://mixedinkey.com/camelot-wheel/) for harmonic mixing. Adding a new song means: look up the BPM and Camelot key (usually on Tunebat), find the song in Apple Music's catalog, add it to the playlist, then set the metadata (BPM in the native field, Camelot key in the Grouping field) via AppleScript. It's five minutes of tedious work per song.

The agent set up MusicKit API auth on my Mac, built a workflow around the catalog search + playlist add endpoints, and handled the AppleScript metadata tagging. I asked it to add five songs and it knocked them all out, including looking up each key on Tunebat via browser automation. Now the whole process is: I say "add [song] to BB2" and it handles the rest.

Not groundbreaking, but the kind of chore that accumulates. Five songs times five minutes each is almost half an hour I got back.

## 3. Filing a pet insurance claim

This one surprised me. Our cat Lexie is going through oncology treatment, and I needed to file a claim on Nationwide's pet insurance portal. I sent the agent the invoice PDF and a medical record, and asked it to file the claim.

The portal turned out to be an Angular app that actively resists automation. Standard browser automation (click this button, fill this field) failed at almost every step:

- **Form fields** wouldn't accept typed input. The agent had to use JavaScript to call native value setters on the DOM elements and manually dispatch `input` and `change` events to trigger Angular's change detection.
- **The file upload input** silently ignored the standard upload API (reported success, attached nothing). Clicking the upload button opened a native OS file dialog that froze the browser tab. The workaround: spin up a local HTTP server on the VM, `fetch()` the PDF from within the page context, construct a `File` object via the `DataTransfer` API, and inject it into the file input.
- **The terms checkbox** would uncheck itself when clicked normally. Had to set `.checked = true` via JavaScript and dispatch events manually.
- **Buttons** that appeared in the page snapshot wouldn't respond to clicks. Had to use `element.click()` through JavaScript evaluation.

Despite all that, it filled the form, uploaded both documents, accepted the terms, and submitted successfully. The whole thing took about 45 minutes of back-and-forth, but now it's saved as a reusable skill. Next claim should take under five minutes.

## The meta thing

What strikes me isn't any single task. It's that the agent figured out workarounds for problems I wouldn't have had the patience to debug myself. I would have just filled in the insurance form manually. I definitely wouldn't have discovered that Apple Photos has ML quality scores accessible through a Python library. And I certainly wouldn't have spent an evening writing AppleScript to tag Camelot keys in playlist metadata.

The agent did all of this from a $60 Raspberry Pi in a closet, delegating heavy work to my desktop VM when needed. It documented everything it learned in memory files so it can pick up where it left off next session. That's the part that feels genuinely new: not a one-shot demo, but something that accumulates capability over time.

It also named itself. But that's a story for another post.
