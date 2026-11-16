# Budget

A personal monthly budget that runs on GitHub Pages and keeps its data in a private GitHub repository.

Five places on a phone: **Home**, **Activity**, a **+** to add, **Budget** and **Upcoming**. Savings, Insights, Reports and Settings are in the menu at the top.

**Home**
- **To confirm**: payments and income whose day has come. Nothing is recorded by itself: mark each one **Paid** (with the real amount), **Skip** it, or **Postpone** it.
- **What you'd have left this month**: your spending money minus everything still to come out of it this month (payments to confirm, money moving into set-asides), and what that means per day. Switches add **planned payments** and the **wishlist items you tick**. "How is this worked out?" lists every item.
- Safe to spend against an optional monthly limit, your total balance (set aside and spending money), income, spending and net for the time frame, and what's coming up this week. Tap any number to see how it's worked out.
- **Customise this page**: hide sections or change their order. The layout is saved with your budget, so every device matches.

**Activity**
- Every transaction as a **list** (search, filters, CSV export) or a **calendar**: what came in and went out each day, dots on days with payments to come, and each day's details with an Add button.
- **Quick add** with a big amount and a number keypad that works as a calculator (12.50 + 4), a grid of categories (most recent first), Today/Yesterday, note suggestions, and "Save & add another".

**Budget**
- **Month plan** for this month or next: expected income (what came in last month, or your own figure) minus recurring payments, planned payments, set-asides and category budgets = what's left unbudgeted, and per day. Over-planning is flagged. Every line opens its breakdown.
- **Categories**: each category's budget for a month is what you give it when you split your income; in a month where income hasn't been given to categories, its usual monthly amount is used (set them together, or have them **suggested from your average spending**). **Move money** between categories, set-asides and unbudgeted money, and **cover** an overspent category. Mark each as a need or a want. **Deleting a category** lets you share out its budget and move its transactions to another one. Unspent money goes back to your spending money.
- **Savings**: the set-asides you mark as savings, with the total, what went in and out for the time frame, your savings rate, a growth chart, and everything taken out. The app asks before money leaves savings. Also a page of its own in the menu and a card on Home.
- **Set-asides**: savings goals and pots, the default split for each kind of income (with the **Save for my goals** and **50/30/20** presets), saving schedules (an amount every N days, weeks or months; reach a target by a date or within a length of time), money set aside automatically or from income, moving money between set-asides, **snoozing** a set-aside for the month (nothing goes into it until next month, or until you resume it), a safety buffer, and checks on whether each goal is on track.

**Upcoming**
- **Recurring payments** and **planned payments/income** that repeat once, daily, weekly, every 2 or 4 weeks, twice a month, monthly, every 3 or 6 months, yearly, or every N days/weeks/months/years; end never, on a date, or after N times ("3 of 12 paid").
- **Set money aside for any payment**: all of it a number of days before, an amount every N days/weeks/months, or spread monthly until it's due. The payment is paid from that money.
- The **next 60 days** with the spending money left after each item and the lowest point. Tap a payment there to **change just that one** (its amount this time, or its date) without touching the rest.
- A **wishlist**: price, priority, link and note; saved up from income or automatically on a schedule; "ready around…", "buying it now would leave you…", a tick to count it on Home, Bought (paid from what was set aside), and a "saved by not buying" total.

**Also**
- **Split every income**: when income comes in, in any form, you're asked how much goes to **savings**, to **goals and wishlist items**, and to each **spending category**, with the rest left unbudgeted. It's filled in from your default split and each category's usual amount. A recurring or planned income can have its **split planned ahead**; it's filled in when the income arrives, and the Budget's month plan follows it.
- The **time frame** (today, this week, the last 7 or 30 days, this month, last month, this year, all time, or your own dates) on every page that shows money. Budgets scale each monthly amount to the range.
- Pay for an expense **from a set-aside**; a set-aside meant for a category is pre-selected for it.
- **Insights**: plain-word findings and charts (money in and out, spending pace, where income went, categories, weekdays, income sources, balance over time). **Reports**: 12 months of income and spending.
- Pay that lands at the end of a month can **count in the next month**.
- Any common currency; light and dark mode; import from the Spend & Save app; use it from any device, synced through GitHub and working offline.

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
