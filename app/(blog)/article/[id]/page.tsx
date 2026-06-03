import { notFound } from "next/navigation"
import type { Metadata } from "next"
import { getArticlesById, getAllArticleIds, extractTocItems, getSeriesArticles } from "@/app/lib/articles"
import ArticlePageClient from "./ArticlePageClient"

type Props = {
    params: Promise<{ id: string }>
}

export async function generateStaticParams() {
    const ids = await getAllArticleIds()
    return ids.map((id) => ({ id }))
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { id } = await params
    const article = await getArticlesById(id)

    if (!article) {
        return { title: "文章未找到" }
    }

    return {
        title: article.title,
        description: article.excerpt,
        openGraph: {
            title: article.title,
            description: article.excerpt,
            type: "article",
            publishedTime: article.date,
            tags: article.tags,
        },
    }
}

export default async function ArticlePage({ params }: Props) {
    const { id } = await params
    const article = await getArticlesById(id)

    if (!article) {
        notFound()
    }

    const tocItems = extractTocItems(article.content)

    let seriesArticles = null
    let seriesIndex: number | null = null
    if (article.series) {
        seriesArticles = await getSeriesArticles(article.series.name)
        seriesIndex = seriesArticles.findIndex((a) => a.id === id)
    }

    return (
        <ArticlePageClient
            article={article}
            tocItems={tocItems}
            seriesArticles={seriesArticles}
            seriesIndex={seriesIndex}
        />
    )
}
