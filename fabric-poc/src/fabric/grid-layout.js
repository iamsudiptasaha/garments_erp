export function gridColumns(columns, order, hidden) {
  const byKey = new Map(columns.map((column) => [column.key, column]));
  const arranged = [...new Set([...(Array.isArray(order) ? order : []), ...byKey.keys()])]
    .map((key) => byKey.get(key))
    .filter(Boolean);
  const visible = arranged.filter(({ key }) => !Array.isArray(hidden) || !hidden.includes(key));
  return { arranged, visible: visible.length ? visible : arranged };
}

export function fitGridColumns(columns, records, available, widths) {
  const context = document.createElement('canvas').getContext('2d');
  const measured = columns.map(({ key, label }) => {
    context.font = 'bold 15px Arial';
    let width = context.measureText('↑ ' + label).width;
    context.font = '15px Arial';
    for (const row of records) {
      for (const value of row.displayValues?.[key] ?? [row[key]]) {
        for (const line of String(value ?? '').split('\n')) {
          width = Math.max(width, context.measureText(line).width);
        }
      }
    }
    return Math.min(480, Math.max(72, Math.ceil(width) + 24));
  });
  const fixed = columns.map(({ key }) =>
    Number.isInteger(widths[key]) && widths[key] >= 48 && widths[key] <= 1600 ? widths[key] : 0,
  );
  const minimum = measured.reduce((sum, width, index) => sum + (fixed[index] || width), 0);
  const flexible = measured.reduce((sum, width, index) => sum + (fixed[index] ? 0 : width), 0);
  const extra = Math.max(0, available - minimum);
  return columns.map((column, index) => ({
    ...column,
    width: fixed[index] || measured[index] + Math.floor((extra * measured[index]) / flexible),
  }));
}

// Borders use canonical column indices in storage and visible indices inside the workbook.
export function projectBorders(borders, from, to) {
  const positions = from.map(({ key }) => to.findIndex((column) => column.key === key));
  return (Array.isArray(borders) ? borders : []).flatMap((border) => {
    if (!border?.value) return [];
    if (border.kind === 'cell') {
      const value = border.value.value;
      if (!value) return [];
      const column = positions[value.col_index];
      return column >= 0
        ? [{ ...border, value: { ...border.value, value: { ...value, col_index: column } } }]
        : [];
    }
    if (!Array.isArray(border.column)) return [];
    const projected = positions
      .slice(border.column[0], border.column[1] + 1)
      .filter((column) => column >= 0)
      .sort((left, right) => left - right);
    const ranges = [];
    for (const column of projected) {
      const previous = ranges.at(-1);
      if (previous?.[1] === column - 1) previous[1] = column;
      else ranges.push([column, column]);
    }
    return ranges.map((column) => ({ ...border, column }));
  });
}
