# Feature comparison chart — Excel / Canva

## Files
- `feature-comparison.csv` — full matrix (for heatmap or grouped bar)
- `feature-comparison-summary.csv` — totals for a simple poster bar chart

## Excel — simple bar chart (recommended for poster)

1. Open `feature-comparison-summary.csv` in Excel.
2. Select columns **Platform** and **Features Supported (out of 12)**.
3. Insert → Chart → **Clustered Bar Chart** (horizontal bars read well on posters).
4. Title: **Integrated STEM Learning Features by Platform**
5. Colors: StudyCanvas = green `#16a34a`, others = grey `#9ca3af`.

## Excel — radar chart (optional)

1. Open `feature-comparison.csv`.
2. Transpose so platforms are series and features are axes (or pick 6 key features).
3. Insert → **Radar Chart**.
4. Use only these rows for clarity:
   - AI text Q&A
   - Infinite canvas / whiteboard
   - AI understands canvas layout & selection
   - Auto STEM flowcharts on workspace
   - Math graphs plotted on canvas
   - Chat + canvas in one workspace

## Canva

1. Canva → Create → **Chart** → Bar chart or Radial chart.
2. Paste data from `feature-comparison-summary.csv`:

| Platform      | Score |
|---------------|-------|
| StudyCanvas   | 12    |
| ChatGPT       | 6     |
| Miro          | 4     |
| Notion AI     | 5     |

3. Subtitle: *Based on 12 integrated STEM-learning features (see report).*

## Poster caption (paste under figure)

*Figure X: Feature comparison of StudyCanvas against common study tools. Scores reflect support for spatial AI, document integration, and on-canvas STEM visuals (max 12 features).*

## Scoring key (for report footnote)

- **2** = Full support  
- **1** = Partial (e.g. upload without canvas integration)  
- **0** = Not supported  

StudyCanvas is the only platform scoring full support on canvas-aware AI and auto-generated STEM visuals.
