function createQualityHeader(title = 'Qualité', subtitle = '') {
  const header = document.createElement('div');
  header.className = 'quality-header';

  const heading = document.createElement('h2');
  heading.textContent = title;
  header.appendChild(heading);

  if (subtitle) {
    const text = document.createElement('p');
    text.textContent = subtitle;
    header.appendChild(text);
  }

  return header;
}

window.createQualityHeader = createQualityHeader;
