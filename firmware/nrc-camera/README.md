# Mach-X Rideshare Rocket Video Recorder (ESP32-CAM)

This directory contains autonomous, fail-safe video recording firmware designed for an **AI-Thinker ESP32-CAM module** pointing down from the bottom of the payload bay.

## 1. Flight Design & Zero-Failure Philosophy

Since the camera has no data connection to the main flight computer and is powered solely by the 5V power bus, it must operate autonomously:
1. **Instant-On:** The camera boots the millisecond the main rocket power switch is flipped.
2. **Infinite Recording:** It immediately begins capturing high-frequency JPEG frames and writing them to the onboard MicroSD card.
3. **Power-Cut Robustness:** Instead of writing a complex, fragile video container (like AVI or MP4) that will corrupt and become unplayable if power is suddenly cut on landing, this firmware saves **individual sequential JPEG frames** (e.g. `/rec_1/frame_00001.jpg`).
4. **Zero-Corruption:** Each JPEG file is opened, written, and closed in under 30 milliseconds. If power cuts out mid-flight, **only the single active frame is lost**. 100% of all previously captured footage remains completely intact, safe, and readable on the SD card.

---

## 2. Compile & Flash Instructions

To flash this code onto the ESP32-CAM using PlatformIO:

```bash
cd firmware/nrc-camera
pio run --target upload
```

> [!NOTE]
> Since standard ESP32-CAM boards do not have an onboard USB-to-UART chip, you must connect the board to your computer using an external FTDI programmer (configured to 3.3V) with GPIO 0 jumpered to GND to enter flashing mode. Remove the GPIO 0 jumper and reset the board to begin normal recording.

---

## 3. Stitching Frames Into an MP4 Video

After recovery, remove the MicroSD card from the camera. You will see directories such as `/rec_1/`, `/rec_2/`, etc., containing thousands of sequential JPEG files.

You can easily stitch these frames into a beautiful, fluid 20fps or 30fps MP4 video using **FFmpeg** on your computer:

```bash
# Navigate to the recording folder
cd rec_1

# Stitch the JPEGs into an MP4 video
ffmpeg -framerate 15 -i frame_%05d.jpg -c:v libx264 -pix_fmt yuv420p -y flight_footage.mp4
```

### FFmpeg Parameter Breakdown:
* `-framerate 15`: Sets the output playback frame rate to 15 frames per second (adjust to 20 or 30 to speed up or slow down the playback).
* `-i frame_%05d.jpg`: Specifies the input filename pattern matching `frame_00001.jpg` to `frame_99999.jpg`.
* `-c:v libx264`: Uses the high-compatibility H.264 video codec.
* `-pix_fmt yuv420p`: Sets the pixel format to YUV420p, ensuring the resulting MP4 plays seamlessly on all mobile phones, QuickTime, VLC, and Windows Media Player.
