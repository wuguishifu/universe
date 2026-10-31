import { NextResponse } from 'next/server';

// Resume PDFs are published as GitHub release assets by
// .github/workflows/compile-resume.yml.
const REPO = 'wuguishifu/universe';
const TAG_PREFIX = 'resume-v';
const ASSET_NAME = 'resume.pdf';
const DOWNLOAD_NAME = 'Bo Bramer Resume.pdf';

const REVALIDATE_SECONDS = 60 * 60;
const RELEASES_PER_PAGE = 100;
const MAX_RELEASE_PAGES = 10;

type Release = {
  tag_name: string;
  draft: boolean;
  assets: { id: number; name: string }[];
};

function github(path: string, accept = 'application/vnd.github+json') {
  return fetch(`https://api.github.com/repos/${REPO}${path}`, {
    headers: {
      Accept: accept,
      Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
    next: { revalidate: REVALIDATE_SECONDS, tags: ['resume'] },
  });
}

// The repo publishes releases for many projects, so GitHub's "latest release"
// is usually not the resume. Releases are returned newest first; walk them
// until we hit a resume release that has the PDF attached.
async function findLatestResumeAssetId(): Promise<number | null> {
  for (let page = 1; page <= MAX_RELEASE_PAGES; page++) {
    const res = await github(
      `/releases?per_page=${RELEASES_PER_PAGE}&page=${page}`,
    );
    if (!res.ok) {
      throw new Error(`Listing releases failed with ${res.status}`);
    }

    const releases: Release[] = await res.json();
    for (const release of releases) {
      if (release.draft || !release.tag_name.startsWith(TAG_PREFIX)) continue;
      const asset = release.assets.find((a) => a.name === ASSET_NAME);
      if (asset) return asset.id;
    }

    if (releases.length < RELEASES_PER_PAGE) break;
  }
  return null;
}

export async function GET(): Promise<NextResponse> {
  if (!process.env.GITHUB_TOKEN) {
    // eslint-disable-next-line no-console
    console.error('GITHUB_TOKEN is not set; cannot fetch resume');
    return new NextResponse('Resume unavailable', { status: 500 });
  }

  try {
    const assetId = await findLatestResumeAssetId();
    if (assetId === null) {
      return new NextResponse('Resume not found', { status: 404 });
    }

    const res = await github(
      `/releases/assets/${assetId}`,
      'application/octet-stream',
    );
    if (!res.ok) {
      throw new Error(`Downloading resume asset failed with ${res.status}`);
    }

    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${DOWNLOAD_NAME}"`,
        'Cache-Control': `public, max-age=0, s-maxage=${REVALIDATE_SECONDS}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load resume', error);
    return new NextResponse('Resume unavailable', { status: 502 });
  }
}
