<div align="center">

# Energy Rhythm Graph

**A GitHub contribution graph reimagined by circadian rhythm.**  
Automatically generates a color-coded SVG of your commits, colored by the time of day you code.

[![License: MIT](https://img.shields.io/badge/License-MIT-blueviolet?style=flat-square)](./LICENSE)

| State | Hours | Color |
|---|---|---|
| **Late Night** | 00h – 05h | Neon Purple |
| **Morning** | 06h – 11h | Soft Gold |
| **Afternoon** | 12h – 17h | Vibrant Orange |
| **Evening** | 18h – 23h | Green |

</div>

---

<div align="center">
   
# Exemple:
Not very colorful, but it's still an example hahahaha.

<p align="center">
  <img src="https://raw.githubusercontent.com/hugotakeda/GitHub-Contribution-Graph/main/dist/energy-rhythm.svg?v" />
</p>

</div>

---

## Quick Start (5 minutes)

1.  **Fork** this repository.
2.  Generate a **Personal Access Token (classic)** with `repo` and `read:user` scopes at [github.com/settings/tokens](https://github.com/settings/tokens).
3.  In your fork, go to **Settings → Secrets and variables → Actions** and add a new secret:
    *   **Name:** `GRAPH_TOKEN`
    *   **Value:** (your generated token)
4.  Go to the **Actions** tab, select **Generate Energy Rhythm SVG**, and click **Run workflow**.
5.  Add the generated SVG to your profile README:

```markdown
<p align="center">
  <img src="https://raw.githubusercontent.com/YOUR_USERNAME/GitHub-Contribution-Graph/main/dist/energy-rhythm.svg" />
</p>
```
*Replace `YOUR_USERNAME` with your GitHub handle.*

---

## Configuration (Optional)

The included workflow defaults to **America/Sao_Paulo**. Running the script directly defaults to **UTC**. To use your local time:
1.  Go to **Settings → Secrets and variables → Actions**.
2.  Switch to the **Variables** tab (top right).
3.  Click **New repository variable**.
4.  **Name:** `TIMEZONE` | **Value:** `America/Sao_Paulo` (or [your timezone](https://docs.sentinel.thalesgroup.com/softwareandservices/ems/EMSdocs/WSG/Content/TimeZone.htm)).

---

## How it works

The system uses **Node.js** and the **GitHub GraphQL API** to fetch your commit history from the last 365 days. 

-   **Logic:** Each day is colored based on the *predominant* hour of your commits.
-   **Glow:** High-frequency days (6+ commits) get a subtle neon glow effect.
-   **Precision:** The SVG is locked at **775px** width to perfectly align with other standard GitHub metrics cards.

---

## License

[MIT](./LICENSE) © 2026 hugotakeda

## Counting rules

- Counts commits attributed to your account on accessible owned/collaborator repositories' default branches, excluding forks. This is not GitHub's native contributions calendar, which also includes other activity.
- Paginates repository and commit history queries, deduplicates commit IDs, and uses author dates in the selected timezone.
- Excludes this graph's historical automatic SVG refresh commits by repository, exact message, and bot committer. It does not exclude human code changes in this repository.
- Future SVG updates use `github-actions[bot]` as both author and committer. Historical GitHub contribution credit is unchanged; the exclusion only affects this SVG.

Run regression checks with `node --test tests/generateSvg.test.js`.

## Snake animation

The calendar now includes three automatically looping snake rounds:

- Every active day is food, regardless of Late Night, Morning, Afternoon, or Evening.
  Empty days are traversable space. A square counts once, even if it represents many commits.
- The snake grows after eating. Its head takes the most recently eaten square's color.
- Randomized continuous routes can clear all food. In risk-taking rounds, a random wrong
  turn can cause an actual collision with occupied body, ending the round.
- A win or loss remains visible briefly, then the original contribution squares return.
- Routes and risk choices are simulated during SVG generation, with a seed derived from
  the calendar data. The SVG repeats those precomputed rounds; it does not generate fresh
  randomness on every page view. A new calendar produces new routes.
- Animation uses SVG SMIL, with no scripts, external assets, or browser game controls.
  Reduced-motion preferences show the original static calendar.
- The animation does not change commit counts, dates, time-of-day colors, or Git history.
  It uses the existing SVG URL, so the profile README needs no additional image.

The route generator uses randomized backbite moves on a covering path. This lets cautious
rounds reach every square while still allowing risky turns to lose by self-collision.
The simulation only allows adjacent grid moves and never treats the vacating tail as an
occupied collision target. On an empty calendar the graph stays static.

Run all regression tests with `node --test tests/*.test.js`.
For a static SVG when calling the renderer directly, use `buildSvg(days, { animate: false })`.
