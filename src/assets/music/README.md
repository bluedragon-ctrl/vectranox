# Music

Drop `.ogg` (or `.mp3`) tracks here. Every file in this folder is picked up at build time and
played as a shuffled playlist with crossfades; the file name becomes the track name shown in the
panel (`02_night-drive.ogg` → `02 NIGHT DRIVE`). Each run starts on its backdrop's song, by that
name (`BACKDROPS` in `src/config/run.ts`), so renaming one of those files means updating it there.
