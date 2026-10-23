/**
 * End-to-end flow from the RGK spec. Needs: a running app (npm run dev) connected to a TEST Supabase project
 * with "Confirm email" turned OFF. Run with: npm run test:e2e
 */
import { expect, test, type Page } from "@playwright/test";

const stamp = Date.now().toString(36);
const mk = (k: string) => ({ email: `rgk.${k}.${stamp}@example.com`, username: `e2e_${k}_${stamp}`.slice(0, 24), password: "Test-pass-12345", name: `E2E ${k.toUpperCase()}` });
const A = mk("a"), B = mk("b");

async function signup(page: Page, u: ReturnType<typeof mk>) {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill(u.name);
  await page.getByLabel("Username").fill(u.username);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByLabel("Confirm password").fill(u.password);
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.waitForURL("**/chat");
}
const send = async (page: Page, text: string) => { await page.getByLabel("Message", { exact: true }).fill(text); await page.keyboard.press("Enter"); };
// message bubbles only — the sidebar preview shows the same text and would make getByText ambiguous
const log = (p: Page) => p.locator('[role="log"]');

test("two users chat in real time and history persists across reloads", async ({ browser }) => {
  const pa = await (await browser.newContext()).newPage();
  const pb = await (await browser.newContext()).newPage();
  await signup(pa, A); await signup(pb, B);

  await pa.getByLabel("Search users").fill(B.username);
  await pa.getByRole("button", { name: new RegExp(B.name) }).click();
  await send(pa, "hello from A");

  await expect(pb.getByRole("button", { name: new RegExp(A.name) })).toBeVisible();
  await pb.getByRole("button", { name: new RegExp(A.name) }).click();
  await expect(log(pb).getByText("hello from A")).toBeVisible();
  await send(pb, "reply from B");
  await expect(log(pa).getByText("reply from B")).toBeVisible();

  await pa.reload(); await pb.reload();
  await pa.getByRole("button", { name: new RegExp(B.name) }).click();
  await pb.getByRole("button", { name: new RegExp(A.name) }).click();
  for (const p of [pa, pb]) { await expect(log(p).getByText("hello from A")).toBeVisible(); await expect(log(p).getByText("reply from B")).toBeVisible(); }
  // Step 10 (outsider C cannot read the conversation) is covered by tests/rls/rls.test.ts.
});
