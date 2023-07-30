import RSS from 'rss';
import type { RequestHandler } from '@sveltejs/kit';
import { prismaClient } from '$lib/server/prisma/client';
import { marked } from 'marked';
import { sanitizeHtml } from '$lib/utils';

// @TODO: Move caching to redis

let cachedFeed: string | undefined

export async function rebuildCachedTwinFeed() {
  cachedFeed = await createTwinRssFeed()
}

async function createTwinRssFeed() {
	const feed = new RSS({
		title: 'This Week in Neovim RSS Feed',
    description: 'This Week In Neovim is a weekly newsletter with updates from the Neovim ecosystem, including new plugins and breaking changes.',
		site_url: 'https://dotfyle.com/this-week-in-neovim',
		feed_url: 'https://dotfyle.com/this-week-in-neovim/rss'
	});
	const posts = await prismaClient.twinPost.findMany({
		where: {
			publishedAt: {
				not: null
			}
		},
		orderBy: {
			issue: 'desc'
		},
    take: 10,
	});

	for (const post of posts) {
		if (!post.publishedAt) continue;
    const html = marked(post.content)
    const description = await sanitizeHtml(html)
		feed.item({
			title: post.title,
			url: `https://dotfyle.com/this-week-in-neovim/${post.issue}`,
			date: post.publishedAt,
			description,
		});
	}

  const xml = feed.xml({ indent: true })

  return xml
}

export const GET: RequestHandler = async () => {
  if (!cachedFeed) {
    cachedFeed = await createTwinRssFeed()
  }
	return new Response(cachedFeed, {
		headers: {
			'Cache-Control': `max-age=0, s-maxage=${60 * 60 * 24}`, // seconds
			'Content-Type': 'application/rss+xml'
		}
	});
};
