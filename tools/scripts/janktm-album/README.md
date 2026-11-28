# janktm-album

Gets the janktm album's photos and videos into Garage, where
[janktm-service](../../../projects/janktm/service) scans them.

```sh
# what would go where
node tools/scripts/janktm-album/upload.mjs /Volumes/album --dry-run

# a small set to try things on, e.g. against a dev Garage
node tools/scripts/janktm-album/upload.mjs /Volumes/album --album "2022-06-12 GRADUATION!" --limit 50

# everything (resumable: files already there with the same size are skipped)
node tools/scripts/janktm-album/upload.mjs /Volumes/album
```

Each folder directly in the input folder is an album. A file's key is its path under the input
folder, so `2022-06-12 GRADUATION!/Bo's Uploads/IMG_5974.HEIC` is in album `2022-06-12 GRADUATION!`.

- Only photos and videos are uploaded: jpg, jpeg, heic, heif, png, gif, mov and mp4 (any case).
  Everything else is counted and skipped, as are hidden files (`.DS_Store`, `._*`) and files
  directly in the input folder.
- Keys are NFC-normalized, since macOS can list names decomposed.
- Each object gets `Content-Disposition: attachment` with its file name, so the album's "download
  original" links download (Garage ignores presigned URLs' `response-content-disposition`).
- It never deletes. To take a file out of the album, delete it from the bucket; the next scan
  removes it.

S3 credentials come from `platform/s3` through this folder's `.env.local` (`nx setup environment`),
or the env file at `ENV_FILE`. The bucket is `janktm-album` unless `--bucket` or
`JANKTM_ALBUM_BUCKET` says otherwise; it has to exist already.
