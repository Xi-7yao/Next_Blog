"use client"

import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import rehypeSlug from "rehype-slug"
import type { TocItem, ArticlesDetail } from "@/app/lib/articles"
import { TocMobile, TocDesktop, useActiveHeading } from "./TableOfContents"
import PreWithCopy from "./PreWithCopy"

export default function ArticlePageClient({
    article,
    tocItems,
}: {
    article: ArticlesDetail
    tocItems: TocItem[]
}) {
    const [activeId, navigateTo] = useActiveHeading(tocItems)

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

                <nav className="mt-16 pt-6 border-t border-gray-200/80">
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
