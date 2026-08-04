const assert = require('assert');

const { isQualityUuid } = require('../validators/quality/common');
const { cleanUuid: cleanTaskUuid } = require('../validators/quality/tasks');

const validUuids = [
  'f7a646cb-bfaf-4c89-aa3e-e14595d53ec6',
  '5933c526-9e7e-4423-a439-edb89029d64a',
  '9a635086-596f-4e63-9163-7f6c62700ff8',
];

const invalidUuids = [
  '',
  'abc',
  'f7a646cb-bfaf-4c89-e14595d53ec6',
  'f7a646cb-bfaf-4c89-aa3e-e14595d53ecz',
];

function main() {
  validUuids.forEach((uuid) => {
    assert.equal(isQualityUuid(uuid), true, `${uuid} doit etre accepte`);
    assert.equal(cleanTaskUuid(uuid), uuid, `${uuid} doit traverser cleanUuid`);
    assert.equal(isQualityUuid(` ${uuid} `), true, `${uuid} doit etre accepte avec espaces`);
  });

  invalidUuids.forEach((uuid) => {
    assert.equal(isQualityUuid(uuid), false, `${uuid || 'chaine vide'} doit etre refuse`);
    assert.equal(cleanTaskUuid(uuid), null, `${uuid || 'chaine vide'} doit etre nettoye en null`);
  });

  console.log(JSON.stringify({
    ok: true,
    valid_uuid_format: '8-4-4-4-12',
    valid_checked: validUuids.length,
    invalid_checked: invalidUuids.length,
    clean_uuid_uses_common_validator: true,
  }, null, 2));
}

main();
