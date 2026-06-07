(function () {
  if (window.Chart) return;

  function valueLabel(value) {
    const number = Number(value || 0);
    return number.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
  }

  function drawBar(ctx, canvas, labels, values, title) {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 280;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(title || '', 10, 18);

    const max = Math.max(...values.map((v) => Math.abs(Number(v || 0))), 1);
    const top = 34;
    const left = 120;
    const row = Math.max((height - top - 16) / Math.max(values.length, 1), 22);

    values.forEach((raw, index) => {
      const value = Number(raw || 0);
      const y = top + index * row;
      const barWidth = Math.max((Math.abs(value) / max) * (width - left - 92), value === 0 ? 0 : 3);
      ctx.fillStyle = '#475569';
      const label = String(labels[index] || '').slice(0, 22);
      ctx.fillText(label, 10, y + 14);
      ctx.fillStyle = '#e2e8f0';
      ctx.fillRect(left, y + 2, width - left - 92, 14);
      ctx.fillStyle = value < 0 ? '#dc2626' : '#2563eb';
      ctx.fillRect(left, y + 2, barWidth, 14);
      ctx.fillStyle = '#0f172a';
      ctx.fillText(valueLabel(value), left + barWidth + 8, y + 14);
    });
  }

  function drawLine(ctx, canvas, labels, values, title) {
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 600;
    const height = canvas.clientHeight || 280;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillStyle = '#0f172a';
    ctx.fillText(title || '', 10, 18);

    const top = 36;
    const bottom = height - 34;
    const left = 42;
    const right = width - 16;
    const max = Math.max(...values.map((v) => Number(v || 0)), 1);
    const min = Math.min(...values.map((v) => Number(v || 0)), 0);
    const span = max - min || 1;

    ctx.strokeStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.moveTo(left, top);
    ctx.lineTo(left, bottom);
    ctx.lineTo(right, bottom);
    ctx.stroke();

    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((raw, index) => {
      const x = values.length <= 1 ? left : left + (index / (values.length - 1)) * (right - left);
      const y = bottom - ((Number(raw || 0) - min) / span) * (bottom - top);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.fillText(valueLabel(max), 6, top + 4);
    ctx.fillText(valueLabel(min), 6, bottom);
    if (labels.length) {
      ctx.fillText(String(labels[0]).slice(0, 10), left, height - 10);
      ctx.fillText(String(labels[labels.length - 1]).slice(0, 10), Math.max(left, right - 72), height - 10);
    }
  }

  window.Chart = function Chart(canvas, config) {
    const ctx = canvas.getContext('2d');
    const dataset = config?.data?.datasets?.[0] || {};
    const labels = config?.data?.labels || [];
    const values = dataset.data || [];
    const type = config?.type || 'bar';
    const title = config?.options?.plugins?.title?.text || dataset.label || '';

    const draw = () => {
      if (type === 'line') drawLine(ctx, canvas, labels, values, title);
      else drawBar(ctx, canvas, labels, values, title);
    };

    draw();
    return {
      destroy() {},
      update() { draw(); },
    };
  };
})();
