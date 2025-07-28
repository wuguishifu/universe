import { createClient } from '../../prismicio';

const requiredProps = ['project.title', 'project.description', 'project.color_scheme'];

export default async function Projects() {
  const client = createClient();
  const allProjects = await client.getAllByType('project', { fetch: requiredProps });

  return (
    <main className="mx-auto max-w-screen-lg">
      {allProjects.map((post) => (
        <pre key={post.uid}>{JSON.stringify(post, null, 2)}</pre>
      ))}
    </main>
  );
}
