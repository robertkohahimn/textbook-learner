import { Curriculum } from "@/components/curriculum";

export default async function BookPage({
  params,
}: {
  params: Promise<{ bookId: string }>;
}) {
  const { bookId } = await params;
  return <Curriculum bookId={bookId} />;
}
