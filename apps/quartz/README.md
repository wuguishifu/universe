# Quartz

Portfolio website.

## Util

To add a backdrop shadow to an image you can use this command:

```sh
magick input.png \( +clone -background black -shadow 50x50+0+30 \) +swap -background transparent -layers merge +repage output.png
```

You will need to have installed magick first:

```sh
brew install imagemagick
```
