"use client"

import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import rehypeSlug from "rehype-slug"
import type { TocItem, ArticlesDetail, Article } from "@/app/lib/articles"
import { TocMobile, TocDesktop, useActiveHeading } from "./TableOfContents"
import PreWithCopy from "./PreWithCopy"

export default function ArticlePageClient({
    article,
    tocItems,
    seriesArticles,
    seriesIndex,
}: {
    article: ArticlesDetail
    tocItems: TocItem[]
    seriesArticles: Article[] | null
    seriesIndex: number | null
}) {
    const [activeId, navigateTo] = useActiveHeading(tocItems)

    const prevArticle = seriesArticles && seriesIndex !== null && seriesIndex > 0
        ? seriesArticles[seriesIndex - 1]
        : null;
    const nextArticle = seriesArticles && seriesIndex !== null && seriesIndex < seriesArticles.length - 1
        ? seriesArticles[seriesIndex + 1]
        : null;

    return (
        <div className="flex flex-row gap-14">
            <article className="min-w-0 flex-1">
                <header className="mb-10">
                    <h1 className="mb-4 text-3xl font-bold tracking-tight text-gray-900 md:text-4xl">
                        {article.title}
                    </h1>
                    <div className="flex flex-row flex-wrap gap-3 text-sm text-gray-500 items-center">
                        <time dateTime={article.date}>发布于 {article.date}</time>
                        <span>•</span>
                        <span>阅读 {article.readTime}</span>
                        <span>•</span>
                        <div className="flex flex-wrap gap-2">
                            {article.tags.map((tag) => (
                                <Link
                                    key={tag}
                                    href={`/?tag=${encodeURIComponent(tag)}`}
                                    className="text-gray-500 transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded"
                                >
                                    {tag}
                                </Link>
                            ))}
                        </div>
                    </div>
                </header>

                <TocMobile items={tocItems} activeId={activeId} onSelect={navigateTo} />

                <div className="prose prose-gray max-w-none">
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeHighlight, rehypeSlug]}
                        components={{
                            pre: PreWithCopy,
                        }}
                    >
                        {article.content}
                    </ReactMarkdown>
                </div>

                {seriesArticles && seriesIndex !== null && (
                    <nav className="mt-16 pt-6 border-t border-gray-200/80">
                        <p className="mb-4 text-sm text-gray-400">
                            {article.series?.name}
                            <span className="mx-1">·</span>
                            第 {seriesIndex + 1}/{seriesArticles.length} 篇
                        </p>
                        <div className="flex justify-between gap-4">
                            {prevArticle ? (
                                <Link
                                    href={`/article/${prevArticle.id}`}
                                    className="flex-1 text-left rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none"
                                >
                                    <span className="block text-xs text-gray-400 mb-1">← 上一篇</span>
                                    <span className="text-sm font-medium text-gray-700">{prevArticle.title}</span>
                                </Link>
                            ) : (
                                <div className="flex-1" />
                            )}
                            {nextArticle && (
                                <Link
                                    href={`/article/${nextArticle.id}`}
                                    className="flex-1 text-right rounded-lg border border-gray-200 p-3 transition-colors hover:bg-gray-50 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none"
                                >
                                    <span className="block text-xs text-gray-400 mb-1">下一篇 →</span>
                                    <span className="text-sm font-medium text-gray-700">{nextArticle.title}</span>
                                </Link>
                            )}
                        </div>
                    </nav>
                )}
                <nav className={`${seriesArticles ? "mt-8 pt-6 border-t border-gray-200/80" : "mt-16 pt-6 border-t border-gray-200/80"}`}>
                    <Link
                        href="/"
                        className="inline-flex items-center gap-1 text-sm text-gray-500 transition-colors hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded"
                    >
                        <span>←</span>
                        <span>返回首页</span>
                    </Link>
                </nav>
            </article>
            <aside className="hidden lg:block w-64 shrink-0 sticky top-24 self-start">
                <TocDesktop items={tocItems} activeId={activeId} onSelect={navigateTo} />
            </aside>
        </div>
    )
}
