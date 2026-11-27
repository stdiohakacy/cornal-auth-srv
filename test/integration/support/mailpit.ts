/** Minimal client for Mailpit's HTTP API (development SMTP sink from docker-compose). */
export const MAILPIT_SMTP_URL =
  process.env['TEST_SMTP_URL'] ?? 'smtp://localhost:1025';
const MAILPIT_API =
  process.env['TEST_MAILPIT_API'] ?? 'http://localhost:8025/api/v1';

type MailpitSummary = {
  ID: string;
  Subject: string;
  To: { Address: string }[];
};
type MailpitMessage = {
  Subject: string;
  HTML: string;
  Text: string;
  From: { Address: string; Name: string };
};

export async function findMailTo(
  address: string,
): Promise<MailpitMessage | undefined> {
  const search = await fetch(
    `${MAILPIT_API}/search?query=${encodeURIComponent(`to:"${address}"`)}`,
  );
  const { messages }: { messages: MailpitSummary[] } = await search.json();
  const summary = messages[0];
  if (!summary) return undefined;
  const detail = await fetch(`${MAILPIT_API}/message/${summary.ID}`);
  return detail.json();
}
