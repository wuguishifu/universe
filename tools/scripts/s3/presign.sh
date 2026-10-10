#!/bin/sh
# Prints a presigned GET URL for an object in S3 (Garage), using the S3_* credentials from an env file.
#
# Usage: tools/scripts/s3/presign.sh <bucket> <key> [expires-in-seconds]   (default: 3600)
#
# Warns on stderr if the object doesn't exist, but still prints the URL.
set -eu

ROOT=$(cd "$(dirname "$0")/../../.." && pwd)
ENV_FILE="${ENV_FILE:-$ROOT/tools/scripts/s3/.env.local}"

if [ $# -lt 2 ]; then
  echo "usage: $0 <bucket> <key> [expires-in-seconds]" >&2
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "env file not found: $ENV_FILE" >&2
  exit 1
fi

set -a
. "$ENV_FILE"
set +a

cd "$ROOT"
BUCKET="$1" KEY="$2" EXPIRES_IN="${3:-3600}" node -e '
const { S3Client, GetObjectCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: process.env.S3_REGION,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
});
const params = { Bucket: process.env.BUCKET, Key: process.env.KEY };

(async () => {
  try {
    await s3.send(new HeadObjectCommand(params));
  } catch (e) {
    console.error(`warning: s3://${params.Bucket}/${params.Key} not found (${e.name})`);
  }
  console.log(await getSignedUrl(s3, new GetObjectCommand(params), { expiresIn: Number(process.env.EXPIRES_IN) }));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
'
