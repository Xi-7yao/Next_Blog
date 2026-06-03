import { getArticles, getSeriesList } from "../lib/articles"
import ArticleList from "./ArticleList";

type Props = {
    searchParams: Promise<{ tag?: string }>
}

export default async function Home({ searchParams }: Props) {
    const articles = await getArticles();
    const seriesList = await getSeriesList();
    const { tag } = await searchParams;

    const seriesArticleIds = new Set(
        seriesList.flatMap((s) => s.articles.map((a) => a.id))
    );
    const standaloneArticles = articles.filter((a) => !seriesArticleIds.has(a.id));

    return (
        <ArticleList
            articles={articles}
            seriesList={seriesList}
            standaloneArticles={standaloneArticles}
            initialTag={tag ?? null}
        />
    )
}