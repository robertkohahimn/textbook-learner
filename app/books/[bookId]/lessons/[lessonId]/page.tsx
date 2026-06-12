import { Lesson } from "@/components/lesson";

export default async function LessonPage({
  params,
}: {
  params: Promise<{ lessonId: string }>;
}) {
  const { lessonId } = await params;
  return <Lesson lessonId={lessonId} />;
}
