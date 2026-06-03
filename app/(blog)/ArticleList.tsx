"use client"

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Article } from "../lib/articles";
import { useMemo } from "react";

export default function ArticleList({ articles, initialTag }: { articles: Article[]; initialTag: string | null }) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const activeTag = searchParams.get("tag") ?? initialTag;

    function setActiveTag(tag: string | null) {
        const params = new URLSearchParams(searchParams.toString());
        if (tag) {
            params.set("tag", tag);
        } else {
            params.delete("tag");
        }
        const qs = params.toString();
        router.replace(qs ? `/?${qs}` : "/", { scroll: false });
    }

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
                {/* Mobile tag filter */}
                <div className="md:hidden rounded-lg border border-gray-200 shadow-sm bg-white p-4">
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-900">
                        <span className="h-3 w-1 rounded-full bg-gray-400" />
                        按标签过滤
                    </h3>
                    <div className="flex flex-wrap gap-2">
                        {sortedTags.map(([tag, count]) => (
                            <button
                                className={`flex gap-1.5 rounded border border-gray-200 px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none ${
                                    activeTag === tag
                                        ? "bg-gray-900 text-white"
                                        : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                                }`}
                                type="button"
                                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                                key={tag}
                            >
                                {tag}
                                <span className={activeTag === tag ? "text-gray-400" : "text-gray-500"}>
                                    {count}
                                </span>
                            </button>
                        ))}
                    </div>
                </div>
                {activeTag ? (
                    <div className="flex justify-between border border-gray-200 rounded-lg px-4 py-3 bg-gray-50">
                        <p className="text-sm text-gray-600">
                            包含标签{" "}
                            <span className="font-medium text-gray-900">#{activeTag}</span>{" "}
                            的文章
                        </p>
                        <button
                            className="text-sm text-gray-500 transition-colors hover:text-gray-900 cursor-pointer focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded"
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
                                <Link href={`/article/${article.id}`} className="focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded">
                                    <h2 className="mb-2 line-clamp-2 break-words text-2xl font-medium text-gray-900 leading-tight group-hover:text-slate-700 transition-colors">
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
                                                type="button"
                                                key={tag}
                                                className="px-1 py-0.5 transition-colors hover:text-gray-800 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded"
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
                            <Link href={`/article/${article.id}`} className="text-sm text-gray-500 group-hover:border-b hover:text-slate-700 transition-colors focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded">
                                阅读全文
                                <span className="ml-1">›</span>
                            </Link>
                        </article>
                    ))
                )}
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
                                className={`flex gap-1.5 rounded border border-gray-200 px-3 py-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none ${activeTag === tag
                                    ? "bg-gray-900 text-white"
                                    : "bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                                    }`}
                                type="button"
                                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
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