"use client"

import Link from "next/link";
import { Article } from "../lib/articles";
import { useMemo, useState } from "react";

export default function ArticleList({ articles }: { articles: Article[] }) {
    const [activeTag, setActiveTag] = useState<string | null>(null);

    const filteredArticles = activeTag
        ? articles.filter((article) => article.tags.includes(activeTag))
        : articles;

    const sortedTags = useMemo(() => {
        const counts = articles.reduce<Record<string, number>>((acc, article) => {
            for (const tag of article.tags) {
                acc[tag] = (acc[tag] || 0) + 1;
            };
            return acc;
        }, {})
        return Object.entries(counts).sort((a, b) => b[1] - a[1]);
    }, [articles])

    return (
        <div className="flex flex-row gap-10 ">
            <div className="animate-fade-in flex-1 flex flex-col gap-10">
                {activeTag ? (
                    <div className="flex justify-between border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                        <p className="text-sm text-gray-600">
                            包含标签{" "}
                            <span className="font-medium text-gray-900">#{activeTag}</span>{" "}
                            的文章
                        </p>
                        <button
                            className="text-sm text-gray-500 transition-colors hover:text-gray-900 cursor-pointer"
                            onClick={() => setActiveTag(null)}
                        >
                            清除过滤
                        </button>
                    </div>
                ) : null}
                {filteredArticles.length === 0 ? (
                    <p className="py-10 text-center text-gray-500">没有找到相关文章。</p>
                ) : (
                    filteredArticles.map((article) => (
                        <article className="group" key={article.id}>
                            <header className="mb-3">
                                <Link href={`/article/${article.id}`}>
                                    <h2 className="mb-2 line-clamp-2 break-all text-2xl font-medium text-gray-900 leading-tight group-hover:text-blue-600 transition-colors">
                                        {article.title}
                                    </h2>
                                </Link>
                                <div className="flex flex-row flex-wrap gap-3 text-sm text-gray-500 items-center">
                                    <time dateTime={article.date}>发布于 {article.date}</time>
                                    <span>•</span>
                                    <span>阅读 {article.readTime}</span>
                                    <span>•</span>
                                    <div className="flex flex-wrap gap-2">
                                        {article.tags.map((tag) => (
                                            <button
                                                key={tag}
                                                className="transition-colors hover:text-gray-800"
                                                onClick={() => setActiveTag(tag)}
                                            >
                                                {tag}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </header>
                            <p className="mb-3 line-clamp-3 text-gray-600 ">
                                {article.excerpt}
                            </p>
                            <Link href={`/article/${article.id}`} className="text-sm text-gray-500 group-hover:border-b hover:text-blue-600 transition-colors">
                                阅读全文
                                <span className="ml-1">›</span>
                            </Link>
                        </article>
                    ))
                )}
                <div className="flex items-center justify-between border-t border-gray-200/80 pt-8 text-sm">
                    <span className="cursor-not-allowed text-gray-400">← 上一页</span>
                    <span className="text-gray-500">第 1 / 1 页</span>
                    <span className="cursor-pointer text-gray-700 transition-colors hover:text-blue-600">
                        下一页 →
                    </span>
                </div>
            </div>
            <div className="hidden md:block w-64 shrink-0">
                <div className="rounded-lg border border-gray-200 shadow-sm bg-white p-5">
                    <h3 className="mb-4 flex items-center gap-2 text-sm font-medium text-gray-900">
                        <span className="h-3 w-1 rounded-full bg-gray-400" />
                        按标签过滤
                    </h3>
                    <div className="max-h-96 flex flex-wrap gap-2 overflow-y-auto">
                        {sortedTags.map(([tag, count]) => (
                            <button
                                className={`flex gap-1.5 rounded border border-gray-200 px-2.5 py-1 text-xs transition-colors ${activeTag === tag
                                    ? "bg-gray-900 text-white"
                                    : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                                    }`}
                                type="button"
                                onClick={() => setActiveTag((prev) => tag === prev ? null : tag)}
                                key={tag}
                            >
                                {tag}
                                <span className={
                                    activeTag === tag ? "text-gray-400" : "text-gray-500"
                                }>
                                    {count}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    )
} 