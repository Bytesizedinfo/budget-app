# Budget

A personal monthly budget that runs on GitHub Pages and keeps its data in a private GitHub repository.

- Track income and expenses by category.
- Pick the **time frame** on every page that shows money: today, this week, the last 7 or 30 days, this month, last month, this year, all time, or your own dates. Each device remembers its choice. Budgets scale each monthly budget to the range (S$300 a month is S$450 over 45 days).
- **Split every income**: when income comes in, you're asked how much to set aside into each set-aside (a savings goal, a pot, or money kept for one kind of spending) and how much to keep for spending. The amounts are filled in from a default split.
- **Plan** your set-asides: a default split for all income, and its own split (or keep it all) for each kind of income, with each set-aside getting a fixed amount a month, a percentage of the income, or what's due on its **saving schedule** (an amount every N days, weeks or months; reach the target by its date; or reach it within a length of time). Two presets: **Save for my goals** (each on its schedule) and the **50/30/20 rule** (adjustable; the savings share goes to goals on their schedules first, the rest to one set-aside). Mark spending categories as needs or wants to compare your spending with the rule. Try a pay amount before it arrives, compare planned with actually set aside, move money between set-asides, mark a safety buffer, and see whether each goal is on track for its date.
- Pay for an expense **from a set-aside**, so it doesn't eat into your spending money. A set-aside meant for a category is pre-selected for expenses in that category.
- **Insights**: what your spending and income say in plain words, with charts of money in and out, this month's spending pace (and when your spending money would run out), where your income went, spending by category and by day of the week, income by source, and your balance over time.
- See **what you can spend per day** for the rest of the month, from the money you actually have (spending money minus bills still to come), next to Safe to spend.
- Tap any Overview number (total balance, set aside, spending money, income, spent, net) to see **how it's worked out** and every entry behind it.
- Pay that lands at the end of a month can **count in the next month** ("Counts in" when adding income). Spend & Save pay logged "for next month" imports the same way.
- Set one overall monthly spending limit, bills included. The Overview then shows what's **safe to spend** today, this week and this month, with bills still to come set aside, and warns you when you're spending too fast.
- See your **total balance**: everything recorded as income minus spending, split into what's set aside and what's left as spending money.
- Optionally set monthly budgets per category too.
- See reports of spending by category and income versus spending over 12 months.
- Add recurring bills and income, which are recorded automatically each month.
- Choose any common currency in Settings.
- Switch between light and dark mode with the moon/sun button in the header. Each device remembers its own choice.
- Import a backup from the Spend & Save app in **Settings → Import from Spend & Save**. It merges into what's already there, and importing the same file again adds nothing new.
- Use it from any device. Changes sync through GitHub and work offline.

## How privacy works

| What | Where | Who can see it |
|---|---|---|
| App code (this repo) | Public repo `budget-app`, served by GitHub Pages | Anyone, but it contains no data |
| Your budget data | `budget.json` in a **private** repo `budget-data` | Only you |
| Access token | Your browser's storage on each device you connect | Only that browser |

Without a token, the site shows only a setup screen. The app refuses to connect to a public data repository. **Settings → Lock this device** removes the token and the saved copy from a browser.

Every save is a commit in `budget-data`, so you can see or restore any earlier version on GitHub.

## Set up (once)

### 1. Publish the app

1. On GitHub, create a **public** repository called `budget-app`. Leave it empty.
2. Push this folder to it:
   ```
   git remote add origin https://github.com/<your-username>/budget-app.git
   git push -u origin main
   ```
3. In the repo, open **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, then select branch `main` and folder `/ (root)`. Save.
4. After a minute or two, the app is live at `https://<your-username>.github.io/budget-app/`.

### 2. Create the private data repository

1. Create a new repository called `budget-data` and set it to **Private**. It can be empty, because the app creates `budget.json` itself.

### 3. Create an access token

1. Go to [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). This creates a fine-grained token.
2. **Token name:** for example, "Budget app".
3. **Expiration:** pick a date (up to a year). Note it down so you know when to renew.
4. **Repository access:** select **Only select repositories**, then choose `budget-data`.
5. **Permissions → Repository permissions → Contents:** set to **Read and write**. Leave everything else as it is.
6. Select **Generate token** and copy it. GitHub only shows it once.

### 4. Connect each device

1. Open `https://<your-username>.github.io/budget-app/`.
2. Enter your GitHub username, `budget-data`, and the token, then select **Connect**.
   - Your browser can save the token like a password, so it can fill it in on your other devices.
3. On your phone, add the page to your home screen so it opens like an app:
   - **iPhone:** Share → Add to Home Screen.
   - **Android:** ⋮ → Add to Home screen.

To try the app without connecting, open `…/budget-app/?demo`. It uses sample data and saves nothing.

## Renewing the token

When the token expires, the sync button turns red and shows **Reconnect**. Your changes are still kept on the device in the meantime. Here's how to renew:

1. Generate a new token with the same settings, or select **Regenerate** on the old one.
2. In the app, select the sync button (or go to **Settings**), choose **Update token**, and paste the new token.

## How sync works

- Every change is saved in the browser first, then pushed to GitHub about a second later.
- If another device saved in between, the app fetches the newer file and merges both copies record by record:
  - the most recent edit of a record wins;
  - additions from both devices are kept;
  - deletions stay deleted.
- Offline changes wait on the device and sync when you're back online. The sync button shows the current status.
- When you return to the app, it checks GitHub for changes made on your other devices.

## Developing

There is no build step. The app is plain HTML, CSS and JavaScript modules.

```
python -m http.server 8000
```

Then open:

- `http://localhost:8000/?demo` for the app with sample data.
- `http://localhost:8000/tests/` for the logic and sync tests. These run against a fake GitHub API.
- `http://localhost:8000/tests/ui.html` for the UI checks. These click through the app in demo mode, then in connected mode against the fake GitHub API.

Files:

```
index.html, styles.css    page shell, light and dark themes, phone and desktop layouts
sw.js                     offline support (bump CACHE when adding or renaming files)
js/app.js                 startup, navigation, rendering
js/store.js               data model, edits, file format
js/sync.js                GitHub sync, local cache, conflict handling
js/merge.js               merging two copies of the budget
js/recurring.js           monthly recurring entries
js/calc.js                totals, budgets, trends, goal progress
js/charts.js              bar and column charts (no libraries)
js/views/*.js             one file per page
tests/                    in-browser tests
```
