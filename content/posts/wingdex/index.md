---
# TODO(John): title alternates:
#   "Reverse birding: what it took to identify 100 bird photos at once"
#   "What it took to not tap 1,600 times"
title: "I just wanted to identify 100 bird photos at once"
# TODO(John): set the real publish date.
date: 2026-09-25T22:48:00-07:00
tags:
- birds
- photography
- machine learning
- cloudflare
- ios
# TODO(John): set featured_image to the hero photo [P1] once it's in the bundle.
featured_image: ""
# TODO(John): description is a placeholder.
description: "An app, a trademark, a trained model and a reverse geocoder that only knows birding spots, to avoid tapping 1,600 times."
draft: true
---

<!-- TODO(John): BEFORE PUBLISHING. config.toml sets goldmark unsafe = true, so every HTML comment in this file ships in the page source. Remove every "TODO(" comment (`grep -n 'TODO(' content/posts/wingdex/index.md` should print nothing), then set draft: false. -->

<!-- TODO(John): [P1] hero photo. Leading candidate: the January sunbird (also photo X if it qualifies; see the outline's photo X criteria). Which species, and where? -->

On January 19, right after a trip through Taiwan, China and Japan, I had about 100 culled bird photos from my a6700 (shot with [the bird button](/posts/tracking-expand-spot-bird-button/)), and I didn't know what most of them were, so I sat down with [Merlin](https://merlin.allaboutbirds.org/) to go through them.

Identifying one photo, an Osprey from Oaks Bottom, took 16 taps. You pick the photo, pinch until "your bird fills the box", fix the location (Merlin showed my well-tagged photo as "Lat: 45.469, Lng: -122.662", and its search only knew "Portland, OR"), identify, tap **This is my bird** and save, at which point the confirmation page says "Oaks Bottom Wildlife Refuge", so it knew all along. Then **ID another bird** sends you back to the cropping step with the same Osprey still loaded.[^merlin-steps] For the folder, that's 1,600 taps.

<!-- TODO(John): [P2] Merlin screenshot strip of the Oaks Bottom Osprey loop. -->

<!-- TODO(John): [D1] diagram: the 16-step loop x100 (1,600 taps) next to "select all -> review -> save". -->

[^merlin-steps]: The full loop, recorded live: Photo, Choose photo, the photo, pinch to crop, Next, edit the location, search "oaks bottom" (only "Portland, OR"), try the map (it opens at my current location, not the photo's), search again, accept Portland, Done, Identify, This is my bird, Save, ID another bird, and then Choose different photo to get out of the cropping screen, which puts you back at step 2.

For scale, my whole life list is 170 species from a bit over 400 photos, and the biggest batch I've ever imported at once was about 50 (the tests run hundreds). This was never a big-data problem, just a lot of tapping.

Merlin is excellent at what it's for,[^merlin] and so are [Seek](https://www.inaturalist.org/pages/seek_app), which will name nearly anything you point a phone at, and [eBird](https://ebird.org/), the record the rest of birding runs on. All three are built around one bird at a time, ideally while it's still in front of you. That afternoon I asked ChatGPT "How do I use my photo library to update my life list to ebird/merlin app in the least manual way possible", and its "Option 1 (least manual long-term)" was "Start eBird checklists while shooting, attach photos later." That's good advice for a different kind of birder. I couldn't find anything better on Google either, so the folder sat.

[^merlin]: Especially Sound ID. Merlin is built for the moment you're looking at, or listening to, a bird. My problem started weeks after the bird had left.

<!-- TODO(John): [P3] screenshot of ChatGPT's answer. -->

I'd been given a name for my kind of birder a few months earlier. We were birding at literal sunrise at Montrose Point in Chicago when a guy with a big lens asked if I'd seen anything cool, and I told him the truth:

"I just take the pictures and figure it out later, so I have no idea what I've seen."

"Me too. It's called reverse birding."

I assumed that was an established term; today the top Google result for it is the WingDex repo. There are more than 150 bird identifier apps, and I couldn't find one that would take a whole folder of photos after the fact. Three weeks after the trip a coworker mentioned [GitHub Spark](https://github.com/features/spark), and I asked ChatGPT for ideas: "What about that reverse birding app I told you about where using merlin is super annoying because I can't bulk upload pictures and have it automatically parse the location/time and update my bird-dex". It suggested a "Bird-Dex backfiller".

<!-- TODO(John): [P0] screenshot the "reverse birding" Google results before they change. -->

<!-- TODO(John): source for "more than 150" (App Store search? which date?). -->

## Vibe-code an app

Spark builds an app from a prompt and commits each prompt as the commit message, so the [WingDex](https://github.com/jlian/wingdex) history starts with me talking. The first real commit, on February 12, begins:

> Build a mobile-first web app called "Bird-Dex" that is its own bird life-list + sighting tracker, and is compatible with eBird (import/export) and Merlin (Merlin-like life list UX + optional eBird bridge).

It goes on for a while. About an hour of follow-up prompts later, the log looked like this:

<!-- TODO(John): [P4] optional: swap this block for a screenshot of the four commits on GitHub. -->

```text
26215614 Generated by Spark: Ok still no cropping and still no bird ID
ddab6d46 Generated by Spark: Why is there still no crop? Are we doing AI crop? I was thinking user crop. Maybe it could be AI crop first and then user confirm?
250f8924 Generated by Spark: I'm still not seeing a crop box or any indication of AI crop
e1326575 Generated by Spark: Nope, all the same issues I just mentioned none are fixed, no crop, no outing location detection, and no bird ID
```

Within a day it did the thing I wanted. I selected a pile of photos, it rebuilt my outings from each photo's EXIF time and GPS (anything within eight hours of each other became one outing), and I reviewed the birds. Spark was a good way to prove the workflow, and from then on anything that shipped had to get past a test or a measurement first.[^upload-button]

<!-- TODO(John): busiest commit day. As recorded (mixed time zones), Feb 13 has 87 commits; in Pacific time it's Feb 12 with 83. Use one here or cut it. The old "84 on Feb 15" came from committer dates and is wrong. -->

[^upload-button]: The exception was the upload button, which went through twelve commits in 31 minutes on February 15, from "premium upload button with gradient, layered shadow, hover lift" through "premium circular", "refined rectangular", "inline text" and "square upload button with icon above text, right-aligned" to "slightly larger Add button (px-6 py-3, text-base)". Three hours later it got one more: "less rounded Add button". <!-- TODO(John): the outline says 15 commits; I count 12 in 31 minutes (02730a2f..15cd38cc), 13 with 53802f05. -->

## Ask GPT, then map the world

The first real version sent every photo to GPT (gpt-4.1-mini at first, later gpt-5.4-mini), with a quick pass and a second, stronger pass whenever the first one wasn't sure. The prompt included where and when the photo was taken. Each photo took a couple of seconds and occasionally 13, so I sized the progress bar for 10. GPT also handled several things I didn't think about at the time because they came free: it drew a crop box around the bird, said plainly when there was no bird, gave separate answers when there were several, and added a note about the plumage.

<!-- TODO(John): [D2] architecture frame 1: photo -> server -> GPT, with the range blobs in R2. -->

My wife had become the QA department by then. Her first dozen issues, filed over two evenings in February, were about passkeys, time zone ordering and avatar centering, and in March she moved on to the identifications. On March 4 she filed #216:

**Isn't this just a chicken?**[^junglefowl]

<!-- TODO(John): consider crop/size/pairing -->

![A brown hen on grass. WingDex says Common Gallinule, 80%, with Kalij Pheasant at 35%](isnt-this-just-a-chicken.png)

[^junglefowl]: Technically a chicken is a Red Junglefowl, and that's a species WingDex can answer with. eBird also has "Red Junglefowl (Domestic type)", which WingDex only knows how to display.

And later that month, #238:

**High as duck**

<!-- TODO(John): consider crop/size/pairing. The meme's caption includes the uncensored word. Also: ask your wife before featuring her screenshots. -->

![A banana shaped like a duck's head. WingDex says "No bird species identified"](high-as-duck.png)

The next reasonable step was a range map of every bird on Earth. On March 20 I rasterized [BirdLife International's](https://datazone.birdlife.org/) range maps onto a 27 km grid, which came to 10,144 species across 681,023 cells, stored as 681K little blobs in R2.[^tailwind] Every candidate GPT suggested then got a multiplier for where the photo was taken: 1.0 if the bird lives there, 0.85 if it's near its range and 0.5 if it's out of range. That fixed some wrong IDs. It could also punish a right one, which I'd find out in April.

<!-- TODO(John): the outline puts the "dominance gate" (ignore geography when the photo looks certain) here, but I can't find it in the March code. The term shows up in ml/README (E2) for the on-device era, so I've left it for 8.2. Confirm. -->

[^tailwind]: For a while, local dev kept 360k+ of those blobs as loose files inside the project folder. Tailwind v4 scans the project for class names, so it read every one of them, and loading `/` locally took 28 seconds.

## Cloudflare

Spark was a good place to find out whether any of this worked, but not a place to keep it. On February 22 WingDex moved to [Cloudflare](https://developers.cloudflare.com/workers/) Pages with a [D1](https://developers.cloudflare.com/d1/) database, and on April 18 to Workers, mostly for the logs.[^preview] A SwiftUI iPhone app followed on TestFlight.[^ios-100]

Cloudflare was partly a reaction to my [last post that did well on Hacker News](/posts/hdmi-cec/), which pushed this site's old host into paid usage and got the site itself moved to Cloudflare a month later. The rule I came away with is that **a surprise audience shouldn't become a surprise bill**, and Cloudflare's free tier covers a lot if you design to stay inside it. Paying OpenAI for every photo anyone uploaded broke that rule, but I didn't have a better option yet.

<!-- TODO(John): confirm the old host was Netlify and that the HN spike is why you moved (this repo: CF Pages migration Dec 16, 2025; Netlify config removed Dec 21). Name the host or keep it vague. -->

[^preview]: Pages gives every pull request its own preview URL. Workers doesn't by default, so after the move every PR deployed to the same preview and the last deploy won. That went unnoticed for three months, and the fix was one flag, `--preview-alias`.

[^ios-100]: On March 10 the release bot decided the very first iOS build was 1.0.0 and published it, and I reverted it 13 minutes later. The real 1.0.0 comes up again at the end. <!-- TODO(John): the outline says the release notes were the whole project history. The GitHub release is gone, so I couldn't verify; confirm or cut. -->

## The name, and a scam

The app had already been renamed twice: the first Spark prompt called it "Bird-Dex", and by that evening it was "BirdDex". On February 16 at about 10:30 PM I opened #104, **Maybe need a new name**, which starts:

> Too many "birddex" and variants out there. Need something more creative.

The issue has a table of names already taken (Birdex, FeatherDex, Lifer!, Birda and seven more) and five categories of candidates.[^names] I picked WingDex. I honestly thought it was genius. The rename landed the next morning, and that evening at 8:49 PM I sent ChatGPT a photo of the bottle on my counter:

![ChatGPT, Tue Feb 17 at 8:49 PM: a photo of a bottle of Windex on my counter, and "I've decided to name the app WingDex. Can you help generate a logo for it that evokes the vibe of the cleaning product but still very obviously birding coded?"](windex-bottle.png)

It came back with four logos, all of them extremely Windex:

![Four logos: a red-and-blue swoosh bird on a sparkly blue oval, a red italic "WingDex" banner with a chickadee on it, the same wordmark on a Windex-style oval with a warbler, and a pair of binoculars](windex-logos.png)

Three minutes later, at 20:52 by my phone clock, I changed direction:

![20:52 on my phone clock: "I need something a little more like editorial and like magazine vibe actually. Look at the app now. I also like the wingspan logo." Out came a cream serif wordmark with a dove.](editorial-pivot.png "The app behind the prompt is showing demo data: 68 species synthesized from a sanitized eBird CSV, with outings at Stanley Park and at Parque Ibirapuera in São Paulo, where I have not been.")

The Windex vibe lasted three minutes. What stuck was the editorial look and the nod to *Wingspan*,[^wingspan] and today the icon is a green bird with nothing about it that says glass cleaner.

[^names]: Rejected: Wingsnap, Shutterbird, LensLark, Aperch.

[^wingspan]: The board game [*Wingspan*](https://stonemaiergames.com/games/wingspan/). I have bought exactly three board games in my life, *Pandemic Legacy*, *Concordia* and *Wingspan*, and I bought *Wingspan* before I ever took a bird photo.

Five days later, on February 22 at 7:11 PM, my wife filed #167, **WingDex is also a butterfly identifier app 🧐**, and she was right. I had named the app after a cleaning product specifically to be original, and it collided with a butterfly app anyway.

The same developer had about 30 other *Dex apps, one for seemingly every family of animals, and the butterfly one has since disappeared from the App Store. I didn't want to rename again, and my research said a trademark would settle it, so I applied that night with my real email, phone number and home address, which I now know is what a lawyer's office or a forwarding service is for. The web app was already live, so that class was filed as "in use". The iPhone app didn't exist, so that class was "intent to use",[^itu] which amounts to a legal promise to the US government that I will ship an iPhone app.

<!-- TODO(John): confirm the filing date. The outline says Feb 22 (the night of #167); in the planning chat you remembered "March I think". The USPTO record (serial 99664749) has it. Redact application details from any screenshot. -->

The phone call that woke me up the next morning was from someone on a "federally recorded line" who said I owed a one-time declaration fee to keep my trademark valid for 10 years, after which an assigned IP attorney would contact me. I was half asleep with a meeting in 30 minutes, so I paid the $575 with a one-time-use virtual card, figuring the worst case was a chargeback. The charge showed up from a merchant called "The Cadet", the USPTO record showed nothing the caller had described, and after I disputed it Robinhood ruled in my favor and I got $500 back. I also reported it to the USPTO, the FTC and the FBI's IC3. Trademark filings are public and get scraped within hours, so if you file, use a lawyer's address or a forwarding service, and read the USPTO's [warning about misleading notices](https://www.uspto.gov/trademarks/protect/caution-misleading-notices) before you answer the phone.

[^itu]: In the US you can file for a trademark before you use it, as long as you swear you intend to. Once the application is allowed, you have six months to file a Statement of Use showing you've actually started, extendable to three years, or the application dies. The USPTO explains it [here](https://www.uspto.gov/trademarks/apply/intent-use-itu-applications).

<!-- TODO: sections 5-13 (heron, USPTO letter, training, ranking, fitting, dogs/owls, reverse geocoder, ship, dozens of us) pending John's review of sections 0-4. -->
