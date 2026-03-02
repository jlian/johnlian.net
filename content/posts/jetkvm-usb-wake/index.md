---
title: "I had to patch the Linux kernel to wake my PC using a browser, again"
date: 2026-03-02T08:00:00-08:00
tags:
- jetkvm
- linux
- hid
- home lab
- usb
description: "The sequel nobody asked for. Same bug, different USB controller, different SoC, same 17-line kernel patch. This time on a JetKVM with a Rockchip RV1106 and DWC3."
---

Three years ago I [patched the Raspberry Pi kernel](https://johnlian.net/posts/tinypilot-usb-wake/) so TinyPilot could wake my sleeping PC over USB. The PC moved, the TinyPilot retired, and I replaced it with a [JetKVM](https://jetkvm.com/): a dedicated KVM-over-IP device with its own hardware video capture, a web UI, and no Raspberry Pi in sight. Same problem returned. Different USB controller, different SoC, different kernel tree, same trip to the closet.

## The setup

The PC in question is "Tomahawk," a Windows 11 desktop that lives in a media closet and sleeps after 30 minutes of inactivity. JetKVM connects via HDMI (through a DP-to-HDMI adapter) and USB-C, giving me a browser-based remote desktop. When the PC is awake, it works great. When it sleeps, JetKVM shows "No HDMI signal detected" and every keystroke I send vanishes into the void.

A real USB keyboard wakes Tomahawk instantly. JetKVM pretends to be a USB keyboard. It should work. It does not.

## Why it doesn't work (the short version)

Linux's USB HID gadget driver (`f_hid`) never asks the USB controller to send a remote wakeup signal before writing HID reports. When the host is asleep and the USB bus is suspended, writes to `/dev/hidg0` just silently fail. The host's xHCI controller is sitting there, ready to wake on a resume signal, but nobody sends one.

This is the exact same bug I hit with TinyPilot. The fix is the same concept too: make the HID gadget call `usb_gadget_wakeup()` before each write when a configfs flag (`wakeup_on_write`) is set. But the devil is in the details, and JetKVM's details are very different from a Raspberry Pi's.

## DWC3 vs DWC2: the sequel nobody asked for

TinyPilot runs on a Raspberry Pi 4, which uses the Synopsys **DWC2** USB controller. JetKVM runs on a Rockchip RV1106, which uses the Synopsys **DWC3**. Same company, different generation, different driver, different register layout, different wake mechanism.

The good news: DWC3 already has `gadget_wakeup` wired up. When I did this for TinyPilot, mdevaev (the PiKVM creator) had to write `dwc2_hsotg_wakeup` from scratch and hook it into `usb_gadget_ops`. On JetKVM, `dwc3_gadget_wakeup` is already sitting there at line 3135 of `gadget.c`, implemented and ready. Nobody calls it from the HID path, but at least it exists.

The bad news: the only patch that adds `wakeup_on_write` to `f_hid` is mdevaev's PiKVM patch, which was never upstreamed to mainline Linux. JetKVM runs kernel 5.10.160. I needed to port the patch forward.

Here's the full picture of what happens when you press a key:

```
Browser keystroke
  → JetKVM Go app
    → write() to /dev/hidg0
      → f_hidg_write()
        → usb_gadget_wakeup()          ← NEW (the patch)
          → dwc3_gadget_wakeup()        ← already existed
            → writes Recovery to DCTL register
              → DWC3 sends USB resume signal on the bus
                → Intel xHCI detects resume
                  → Windows wakes from S3
```

Two changes needed:
1. **Kernel (`f_hid.c`)**: Add the `wakeup_on_write` configfs attribute, call `usb_gadget_wakeup()` in `f_hidg_write()` when it's set
2. **JetKVM Go app**: Set `bmAttributes = 0xa0` (advertise remote wakeup) and `wakeup_on_write = 1` on all three HID functions

The kernel patch is 17 lines. The Go app change is 5 lines across 4 files. The debugging to get here took an entire Saturday.

## The debugging saga

### Act 1: "This should be easy"

I started by reading my own blog post from 2022. Port the `wakeup_on_write` patch, set the configfs attributes, done. Two hours, tops.

I cloned `jetkvm/rv1106-system` on my VM, ran `install.sh` to set up the ARM cross-compile toolchain, and wrote the patch. The f_hid changes were straightforward, nearly identical to the PiKVM version. Build took about 8 minutes. I flashed the boot partition via SSH (`dd` to `/dev/mmcblk0p7`, the active B-slot), rebooted JetKVM, deployed the Go app with `wakeup_on_write: "1"`, and ran the test:

```bash
echo -ne '\x00\x00\x2c\x00\x00\x00\x00\x00' > /dev/hidg0
```

Nothing happened. Tomahawk stayed asleep.

### Act 2: "Maybe DWC3 needs help too"

I dug into `dwc3_gadget_wakeup()` and found something suspicious. The 5.10 kernel has a polling loop that waits for the USB link to transition to U0 (active) after sending the Recovery signal:

```c
for (retries = 20000; retries > 0; retries--) {
    reg = dwc3_readl(dwc->regs, DWC3_DSTS);
    if (DWC3_DSTS_USBLNKST(reg) == DWC3_LINK_STATE_U0)
        break;
}
```

Twenty thousand iterations of `udelay(100)`. That's two seconds of busy-waiting in a spinlock, polling for a state transition that won't happen until the host finishes resuming from S3, which takes 4+ seconds. The function times out, returns -ETIMEDOUT, and the HID gadget sees a "failed to send remote wakeup" error.

Upstream Linux 6.x removed this loop entirely (the commit message says "racy and not needed for newer versions"). Our DWC3 is v3.30a, well above the 1.94a threshold where the polling was relevant. I patched it out: just write Recovery to DCTL and return success.

Build #5 (both patches): **it works.** Tomahawk wakes in about 14 seconds.

### Act 3: "Wait, do we actually need the DWC3 change?"

I wanted a minimal PR, so I tested build #6 with only the f_hid patch and stock DWC3. It failed. Tomahawk stayed asleep. Conclusion: both patches required. Case closed.

Except... something felt off. The DWC3 polling loop writes Recovery to DCTL *before* it starts polling. The resume signal is already on the wire. The polling just waits for acknowledgment. Why would removing the wait-for-acknowledgment be required for the signal to work?

I checked the JetKVM's USB state more carefully:

```bash
cat /sys/kernel/config/usb_gadget/jetkvm/UDC_state
# not attached
```

Oh. The USB wasn't even connected. I had toggled the UDC for re-enumeration right before putting Tomahawk to sleep, and Windows entered S3 before the USB device finished re-enumerating. Build #6 didn't fail because of the DWC3 polling loop. It failed because there was no USB connection to wake.

Build #8 (f_hid only, stock DWC3, clean USB state): **works perfectly. 4.2 seconds.**

And here's the kicker: it was *faster* than build #5 with the DWC3 fix (14.4s → 4.2s). The stock polling loop holds the DCTL register in Recovery state for about 2 seconds while it spins. That gives the host xHCI controller a nice, sustained resume signal. My "fix" wrote Recovery and immediately moved on, giving the host a brief blip that apparently took longer to act on.

The two "failed to send remote wakeup" messages in dmesg are cosmetic. The Recovery signal was already sent. The DWC3 change got dropped from the PR.

### Act 4: The devmem red herring

Earlier in the day, before the kernel patches, I tried waking Tomahawk by writing directly to DWC3 registers via `devmem`. The DCTL register (device control) is at `0xffb0c704`. I wanted to write Recovery (value 8) into bits [8:5].

It worked! Except... I later realized I'd been writing to `0xffb0c700`, which is DALEPENA (active endpoint enable), not DCTL. The two registers are 4 bytes apart. Writing garbage to DALEPENA probably caused a USB bus fault that the host xHCI interpreted as a wake event. Not proper remote wakeup, just an accidental electrical hiccup that happened to do what I wanted.

## The results

### Raw USB wake time (SSH to JetKVM, write to /dev/hidg0)

Measured from HID write completion to first successful ping response from the host. Each test started from confirmed cold sleep (100% ping packet loss verified).

| Run | Wake time |
|-----|-----------|
| 1   | 4,016ms   |
| 2   | 4,015ms   |
| 3   | 4,013ms   |
| **Avg** | **4.0s** |

Remarkably consistent. The ~4 seconds is entirely the PC's S3 resume time.

`powercfg /lastwake` confirms the wake source every time:

```
Wake Source [0]:
  Type: Device
  Friendly Name: Intel(R) USB 3.1 eXtensible Host Controller
```

### End-to-end via JetKVM web UI

Measured from keypress in the browser to first video frame playing. Instrumented with JS polling `video.currentTime` every 50ms.

| Run | Total time |
|-----|------------|
| 1   | 26.3s      |
| 2   | 26.2s      |
| 3   | 26.5s      |
| **Avg** | **26.3s** |

The 22-second gap between "PC is awake" and "video is playing" breaks down roughly as:

- **~20s**: Windows GPU powering up from D3, reinitializing the display driver, outputting HDMI. This is the dominant factor and entirely outside JetKVM's control.
- **~1s**: JetKVM's capture pipeline restarting (VENC encoder, stream init)
- **~1s**: WebRTC renegotiation (ICE reconnect, first frame decode)

For comparison, my old TinyPilot setup felt nearly instant. The difference is almost certainly the GPU resume, not the KVM device. Different PC, different GPU, different driver.

## The PRs

Three PRs to make this work upstream:

1. **[jetkvm/rv1106-system#57](https://github.com/jetkvm/rv1106-system/pull/57)**: kernel f_hid `wakeup_on_write` patch (2 files, 17 lines)
2. **[jetkvm/kvm#1235](https://github.com/jetkvm/kvm/pull/1235)**: Go app `bmAttributes=0xa0` + `wakeup_on_write=1` (4 files, 5 lines)
3. **[jetkvm/kvm#1236](https://github.com/jetkvm/kvm/pull/1236)** (draft): "Try Wake Host" button in the no-signal overlay

The kernel patch needs to land first. Without it, the Go app changes advertise remote wakeup but can't deliver. The UI button is a nice-to-have that depends on both.

## One caveat

USB wake only works if JetKVM was enumerated by the host *before* it went to sleep. If JetKVM reboots while the PC is already in S3, the USB device controller shows "not attached" and wake writes fail. You can't wake a host that never knew you existed. For that case, you still need Wake-on-LAN or a walk to the closet.

## Wrapping up

Three years later, same bug, different hardware, same 17-line patch to `f_hid.c`. The PiKVM project's `wakeup_on_write` addition to the HID gadget driver is one of those patches that should really be in mainline Linux. Every USB gadget KVM hits this: TinyPilot, PiKVM, JetKVM, NanoKVM. Until it's upstreamed, we'll keep porting it.

Thanks again to [@mdevaev](https://github.com/mdevaev) for the original patch that started all of this. And thanks to the JetKVM team for making a device that's good enough to make me want to fix the one thing it couldn't do.

At least this time I didn't have to write `dwc2_hsotg_wakeup` from scratch. Progress.
