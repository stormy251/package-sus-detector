import test from 'node:test';
import assert from 'node:assert/strict';
import { osaDistance } from '../src/editDistance.js';
import { typosquatCheck, hallucinationPlausibility, buildIndex } from '../src/typosquat.js';
import { popular } from './helpers.js';

test('osaDistance', () => {
    assert.equal(osaDistance('react', 'react'), 0);
    assert.equal(osaDistance('react', 'reakt'), 1);
    assert.equal(osaDistance('react', 'raect'), 1); // transposition
    assert.equal(osaDistance('lodash', 'lodahs'), 1);
    assert.equal(osaDistance('abc', 'xyzxyz', 2), 3); // cutoff + 1
    assert.equal(osaDistance('axios', 'axois'), 1);
});

test('typosquatCheck: popular name is not flagged', () => {
    const r = typosquatCheck('react', 'npm', popular.npm);
    assert.equal(r.suspected, false);
    assert.equal(r.isPopular, true);
    assert.equal(r.popularRank, 1);
});

test('typosquatCheck: edit distance, separator variant, combo', () => {
    assert.equal(typosquatCheck('lodahs', 'npm', popular.npm).matches[0].popular, 'lodash');
    assert.equal(typosquatCheck('expresss', 'npm', popular.npm).strongest, 'edit_distance');
    const sep = typosquatCheck('reactdom', 'npm', popular.npm);
    assert.equal(sep.matches[0].type, 'separator_variant');
    assert.equal(sep.matches[0].popular, 'react-dom');
    const combo = typosquatCheck('axios-js', 'npm', popular.npm);
    assert.equal(combo.matches[0].type, 'combo');
    assert.equal(typosquatCheck('totally-unrelated-name', 'npm', popular.npm).suspected, false);
});

test('typosquatCheck: pypi normalisation', () => {
    assert.equal(typosquatCheck('Reqeusts', 'pypi', popular.pypi).matches[0].popular, 'requests');
    assert.equal(typosquatCheck('Requests', 'pypi', popular.pypi).isPopular, true);
});

test('typosquatCheck: short names do not trigger edit-distance matches', () => {
    const idx = buildIndex(['ms', 'qs', 'debug']);
    assert.equal(typosquatCheck('mz', 'npm', idx).suspected, false);
});

test('hallucinationPlausibility', () => {
    assert.equal(hallucinationPlausibility('flask-super-auth-helper', popular.pypi).plausible, true);
    assert.equal(hallucinationPlausibility('react-utils-helper-pro', popular.npm).plausible, true);
    assert.equal(hallucinationPlausibility('zxqv', popular.npm).plausible, false);
    assert.equal(hallucinationPlausibility('lodash', popular.npm).plausible, false);
});
