import { getArticles } from "../lib/articles"
import ArticleList from "./ArticleList";

type Props = {
    searchParams: Promise<{ tag?: string }>
}

export default async function Home({ searchParams }: Props) {
    const articles = await getArticles();
    const { tag } = await searchParams;

    return (
        <ArticleList articles={articles} initialTag={tag ?? null} />
    )
}