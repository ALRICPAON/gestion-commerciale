function createQualityTimeline() {
  const timeline = document.createElement('ol');
  timeline.className = 'quality-timeline';
  return timeline;
}

window.createQualityTimeline = createQualityTimeline;
