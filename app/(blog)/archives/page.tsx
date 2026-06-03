import type { Metadata } from "next"
import Link from "next/link"
import { getArticles } from "@/app/lib/articles"

export const metadata: Metadata = {
    title: "归档 - Xiyao's Blog",
    description: "文章归档列表",
}

export default async function ArchivesPage() {
    const articles = await getArticles()

    const groupedByYear = articles.reduce<Record<string, typeof articles>>((acc, article) => {
        const year = article.date.split("-")[0]
        if (!acc[year]) acc[year] = []
        acc[year].push(article)
        return acc
    }, {})

    const years = Object.keys(groupedByYear).sort((a, b) => b.localeCompare(a))

    return (
        <div>
            <h1 className="mb-10 text-3xl font-bold tracking-tight text-gray-900">归档</h1>
            <div className="flex flex-col gap-12">
                {years.map((year) => (
                    <section key={year}>
                        <h2 className="mb-4 text-lg font-semibold text-gray-900">{year}</h2>
                        <ul className="space-y-3">
                            {groupedByYear[year].map((article) => {
                                const [, month, day] = article.date.split("-")
                                return (
                                    <li
                                        key={article.id}
                                        className="flex flex-row items-baseline gap-4 group"
                                    >
                                        <time
                                            dateTime={article.date}
                                            className="shrink-0 text-sm text-gray-400 tabular-nums"
                                        >
                                            {month}-{day}
                                        </time>
                                        <Link
                                            href={`/article/${article.id}`}
                                            className="text-base text-gray-700 transition-colors group-hover:text-gray-900 focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:outline-none rounded"
                                        >
                                            {article.title}
                                        </Link>
                                    </li>
                                )
                            })}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    )
}
