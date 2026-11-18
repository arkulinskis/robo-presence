"""Push-to-talk: the pilot's voice coming out of the robot's speaker.

The pilot's browser sends one audio track (silent until they hold Talk). Each pilot gets their own `aplay` process fed
with 48 kHz mono 16-bit PCM, so two people talking at once both come out (Raspberry Pi OS mixes them through PipeWire
or ALSA dmix). Volume is the robot's own: `alsamixer`, or `wpctl set-volume @DEFAULT_AUDIO_SINK@ 80%`.

camera.talk in the config switches it off (the cockpit then hides the Talk button). Viewers' audio is never played.
"""
import asyncio
import logging
import shutil

log = logging.getLogger("robopresence")

RATE = 48000


def available():
    """True when this robot can play sound (aplay comes with alsa-utils, standard on Raspberry Pi OS)."""
    return bool(shutil.which("aplay"))


def _pcm(resampler, frame):
    """Bytes of 16-bit mono PCM from one av.AudioFrame (PyAV 9 returns a frame, PyAV 10+ a list)."""
    out = resampler.resample(frame)
    frames = out if isinstance(out, list) else [out]
    return b"".join(bytes(f.planes[0])[: f.samples * 2] for f in frames if f is not None)


async def drain(track):
    """Read and drop a track nobody should hear (aiortc queues unread frames forever)."""
    from aiortc.mediastreams import MediaStreamError
    while True:
        try:
            await track.recv()
        except MediaStreamError:
            return
        except Exception:
            return


async def play(track, who="Pilot"):
    """Play one pilot's audio track until it ends. Never raises."""
    if not available():
        log.warning("Push-to-talk: no aplay on this robot (sudo apt install alsa-utils), so %s can't be heard.", who)
        return await drain(track)
    try:
        import av
        from aiortc.mediastreams import MediaStreamError
    except Exception as e:  # pragma: no cover - aiortc always brings PyAV
        log.warning("Push-to-talk unavailable: %s", e)
        return await drain(track)
    resampler = av.AudioResampler(format="s16", layout="mono", rate=RATE)
    proc = None
    try:
        # A short buffer keeps the voice close to real time; underruns during silence are harmless.
        proc = await asyncio.create_subprocess_exec(
            "aplay", "-q", "-t", "raw", "-f", "S16_LE", "-c", "1", "-r", str(RATE), "--buffer-time=120000",
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
        log.info("Push-to-talk ready for %s.", who)
        while True:
            try:
                frame = await track.recv()
            except MediaStreamError:
                break
            data = _pcm(resampler, frame)
            if not data or proc.returncode is not None:
                continue
            proc.stdin.write(data)
            try:
                await asyncio.wait_for(proc.stdin.drain(), 1.0)
            except asyncio.TimeoutError:
                pass  # the sound card is behind: drop rather than lag
    except Exception as e:
        log.warning("Push-to-talk for %s stopped: %s", who, e)
        await drain(track)
    finally:
        if proc is not None and proc.returncode is None:
            try:
                proc.stdin.close()  # let aplay finish the last few milliseconds, then make sure it's gone
                await asyncio.wait_for(proc.wait(), 1.0)
            except Exception:
                try:
                    proc.terminate()
                except Exception:
                    pass
