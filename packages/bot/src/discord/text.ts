export function splitText(content: string): string[] {
  const chunks: string[] = [];
  while (content.length > 2000) {
    const head = content.slice(0, 2000);
    const boundary = Math.max(head.lastIndexOf("\n"), head.lastIndexOf(" "));
    let end = boundary > 1000 ? boundary + 1 : 2000;
    if (/[\uD800-\uDBFF]/.test(content[end - 1]!)) end--;
    chunks.push(content.slice(0, end));
    content = content.slice(end);
  }
  chunks.push(content);
  return chunks;
}

export function allowedMentions(content: string, reply: boolean) {
  return {
    parse: [],
    users: [...new Set([...content.matchAll(/<@!?(\d+)>/g)].map((match) => match[1]!))].slice(
      0,
      100,
    ),
    replied_user: reply,
  };
}
