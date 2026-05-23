import { getArticles } from "../lib/articles"
import ArticleList from "./ArticleList";

export default async function Home() {
    const articles = await getArticles();

    return (
        <ArticleList articles={articles} />
    )
}