(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.QualityDocumentationTree = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const codeCollator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

  function sectionOrder(left, right) {
    const orderDifference = Number(left.display_order || 0) - Number(right.display_order || 0);
    if (orderDifference) return orderDifference;
    const codeDifference = codeCollator.compare(String(left.code || ''), String(right.code || ''));
    if (codeDifference) return codeDifference;
    return String(left.id || '').localeCompare(String(right.id || ''));
  }

  function buildSectionTree(sections = [], matches = () => true) {
    const activeSections = sections.filter((section) => !section.archived_at);
    const childrenByParent = new Map();

    activeSections.forEach((section) => {
      const parentId = section.parent_id == null ? null : String(section.parent_id);
      const siblings = childrenByParent.get(parentId) || [];
      siblings.push(section);
      childrenByParent.set(parentId, siblings);
    });
    childrenByParent.forEach((siblings) => siblings.sort(sectionOrder));

    const visit = (section, ancestors = new Set()) => {
      const sectionId = String(section.id);
      if (ancestors.has(sectionId)) return null;
      const nextAncestors = new Set(ancestors).add(sectionId);
      const children = (childrenByParent.get(sectionId) || [])
        .map((child) => visit(child, nextAncestors))
        .filter(Boolean);
      if (!matches(section) && children.length === 0) return null;
      return { section, children };
    };

    return (childrenByParent.get(null) || []).map((section) => visit(section)).filter(Boolean);
  }

  return { buildSectionTree, sectionOrder };
});
