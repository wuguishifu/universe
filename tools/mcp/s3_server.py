# /// script
# requires-python = ">=3.11"
# dependencies = ["mcp>=1.9,<2", "boto3"]
# ///
"""read-only mcp server for the universe s3 (garage) store"""

import os

import boto3
from botocore.config import Config
from mcp.server.fastmcp import FastMCP

MAX_READ_BYTES = 1_000_000

s3 = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT"],
    region_name=os.environ["S3_REGION"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
    aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
    config=Config(
        s3={"addressing_style": "path" if os.environ.get("S3_FORCE_PATH_STYLE") == "true" else "auto"}
    ),
)

mcp = FastMCP("universe-s3")


@mcp.tool()
def list_buckets() -> list[str]:
    """List all buckets."""
    return [b["Name"] for b in s3.list_buckets()["Buckets"]]


@mcp.tool()
def list_objects(
    bucket: str, prefix: str = "", delimiter: str = "/", max_keys: int = 200, continuation_token: str | None = None
) -> dict:
    """List objects in a bucket. Use delimiter "/" to browse like folders, or "" for a flat recursive listing."""
    kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": min(max_keys, 1000)}
    if delimiter:
        kwargs["Delimiter"] = delimiter
    if continuation_token:
        kwargs["ContinuationToken"] = continuation_token
    res = s3.list_objects_v2(**kwargs)
    return {
        "prefixes": [p["Prefix"] for p in res.get("CommonPrefixes", [])],
        "objects": [
            {"key": o["Key"], "size": o["Size"], "last_modified": o["LastModified"].isoformat()}
            for o in res.get("Contents", [])
        ],
        "next_continuation_token": res.get("NextContinuationToken"),
    }


@mcp.tool()
def head_object(bucket: str, key: str) -> dict:
    """Get an object's metadata (size, content type, last modified, user metadata)."""
    res = s3.head_object(Bucket=bucket, Key=key)
    return {
        "size": res["ContentLength"],
        "content_type": res.get("ContentType"),
        "last_modified": res["LastModified"].isoformat(),
        "etag": res.get("ETag"),
        "metadata": res.get("Metadata", {}),
    }


@mcp.tool()
def get_object_text(bucket: str, key: str, max_bytes: int = 100_000) -> str:
    """Read an object as utf-8 text, truncated to max_bytes (capped at 1MB). Binary content is decoded with replacement characters."""
    max_bytes = min(max_bytes, MAX_READ_BYTES)
    res = s3.get_object(Bucket=bucket, Key=key, Range=f"bytes=0-{max_bytes - 1}")
    return res["Body"].read().decode("utf-8", errors="replace")


@mcp.tool()
def presign_get_url(bucket: str, key: str, expires_in: int = 900) -> str:
    """Create a presigned GET url for an object (e.g. to download binary files like audio). Max 1 hour."""
    return s3.generate_presigned_url(
        "get_object", Params={"Bucket": bucket, "Key": key}, ExpiresIn=min(expires_in, 3600)
    )


if __name__ == "__main__":
    mcp.run()
