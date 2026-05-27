async function assertDepartmentBelongsToStore(db, departmentId, storeId) {
  const result = await db.query(
    `
    SELECT id
    FROM departments
    WHERE id = $1
      AND store_id = $2
    `,
    [departmentId, storeId]
  );

  return result.rows[0] || null;
}

module.exports = {
  assertDepartmentBelongsToStore,
};
