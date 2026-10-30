import { describe, expect, it } from 'vitest';
import { normalizeCommand, normalizePath, protectCommand, protectPath } from '../src/shared/protect.js';

describe('normalizePath', () => {
  it.each([
    ['/a/./b//c/../d', '/a/b/d'],
    ['a/../../b', '../b'],
    ['/../x', '/x'],
    ['.\\a\\b', 'a/b'],
    ['', ''],
  ])('%s -> %s', (input, out) => {
    expect(normalizePath(input)).toBe(out);
  });
});

describe('protectPath', () => {
  it.each([
    '/p/.claude/driver/plan.json',
    '.claude/driver/plan.json',
    '/p/.claude/driver/events.jsonl',
    '/p/.claude/driver/log/REL-1.jsonl',
    '/p/.claude/driver/log/anything.txt',
    '/p/.claude/driver/.mod/ticket.json',
    '/p/.claude/driver/.mod/x/y',
    // case aliases (APFS)
    '/p/.Claude/Driver/plan.json',
    '/p/.CLAUDE/DRIVER/Events.JSONL',
    '/p/.claude/driver/.MOD/ticket.json',
    // normalisation
    '/p/.claude/./driver//plan.json',
    '/p/x/../.claude/driver/plan.json',
    '/p/.claude/driver/blocks/../plan.json',
    '/p/.claude\\driver\\plan.json',
  ])('denies %s', (file) => {
    expect(protectPath(file)).toMatch(/^DRIVER:/);
  });

  it.each([
    '/p/.claude/driver/blocks/B-001.md',
    '/p/.claude/driver/requirements/R-001.md',
    '/p/.claude/driver/exports/plan.mmd',
    '/p/.claude/driver/.gitignore',
    '/p/src/plan.json',
    '/p/other/events.jsonl',
    '/p/.claude/settings.json',
    '/p/.claude/driver.json',
    '',
  ])('allows %s', (file) => {
    expect(protectPath(file)).toBeNull();
  });

  it('with realPath and driverDir, tests the real location case-insensitively', () => {
    const driverDir = '/Real/Proj/.claude/driver';
    expect(protectPath('/p/link/plan.json', { realPath: '/real/proj/.claude/DRIVER/plan.json', driverDir })).toMatch(/^DRIVER:/);
    expect(protectPath('/p/link/x', { realPath: '/real/proj/.claude/driver/.mod/ticket.json', driverDir: `${driverDir}/` })).toMatch(/^DRIVER:/);
    expect(protectPath('/p/link/x', { realPath: '/real/proj/.claude/driver/blocks/B-001.md', driverDir })).toBeNull();
    expect(protectPath('/p/link/plan.json', { realPath: '/elsewhere/plan.json', driverDir })).toBeNull();
    expect(protectPath('/p/link/plan.json', { realPath: '/real/proj/.claude/driver-other/plan.json', driverDir })).toBeNull();
    expect(protectPath('/p/link/plan.json', { realPath: '/real/proj/.claude/driver/plan.json' })).toBeNull(); // needs driverDir
  });
});

describe('normalizeCommand', () => {
  it('drops quotes and backslashes, collapses whitespace and path noise', () => {
    expect(normalizeCommand(`  echo  "a"\\b   .claude/./driver//plan.json `)).toBe('echo ab .claude/driver/plan.json');
  });
});

describe('protectCommand', () => {
  const denied = (c: string) => protectCommand(c) !== null;

  it.each([
    'driver gate approve route',
    'driver gate approve route --via-mod',
    // review 6: token matching, not phrase matching
    'printf x | node /p/dist/cli.js gate --via-mod approve release --actor user:diogo',
    'node cli.js gate --via-mod approve release',
    'driver --root . gate --reason x approve route',
    'driver approve gate route',
    'driver block status B-001 done --actor user:diogo',
    'driver block status B-001 done --actor=user:diogo',
    'driver block status B-001 done -f',
    'bash -c "driver gate approve route"',
    'echo hi | grep via-mod',
    'node plugins/driver/dist/cli.js gate approve release',
    'cd x && driver --actor user:diogo   gate approve route',
    'driver gate "approve" route --actor user:me',
    "driver gate 'approve' route",
    'A=approve; driver gate $A route',
    'cd plugins/driver/dist && node cli.js gate approve route',
    'driver rebaseline --reason x',
    'driver block status B-003 in_progress --force',
    'node dist/cli.js block status B-003 in_progress "--force"',
    'driver gate $(echo approve) route',
  ])('user-only: %s', (c) => {
    expect(protectCommand(c)).toMatch(/user-only/);
  });

  it.each([
    'echo {} > .claude/driver/plan.json',
    'echo x >> /p/.claude/driver/events.jsonl',
    "sed -i '' s/a/b/ .claude/driver/plan.json",
    'jq .revision=9 .claude/driver/plan.json > t && mv t .claude/driver/plan.json',
    'tee .claude/driver/events.jsonl < x',
    'cp /tmp/x .claude/driver/plan.json',
    'rm .claude/driver/events.jsonl',
    'truncate -s 0 .claude/driver/events.jsonl',
    'cd .claude/driver && echo {} > plan.json',
    'cd .claude/driver && cp /tmp/x plan.json',
    `node -e "require('fs').writeFileSync('.claude/driver/plan.json','{}')"`,
    `python3 -c "open('.claude/driver/plan.json','w').write('{}')"`,
    'git checkout -- .claude/driver/plan.json',
    'git restore .claude/driver/plan.json',
    'jq . x | sponge .claude/driver/plan.json',
    'dd if=/tmp/x of=.claude/driver/plan.json',
    'echo {} > .claude/./driver/plan.json',
    'echo {} > .claude//driver/plan.json',
    'echo {} > ".claude/driver"/plan.json',
    'echo {} > .claude/dri\\ver/plan.json',
    'rm .claude/driver/log/REL-1.jsonl',
    'perl -e 1 .claude/driver/plan.json',
    // new in this step
    'echo {} > .Claude/Driver/plan.json',
    'rm -f .CLAUDE/driver/events.jsonl',
    'echo {} > .claude/driver/.mod/ticket.json',
    'cp /tmp/t .claude/driver/.mod/ticket.json',
    'echo {} > .claude/dr*/plan.json',
    // review 6: the basename is protected wherever it lives, and cd chains do not hide it
    'echo hi > /tmp/plan.json',
    'cd .claude && cd dri?er && printf x > .mod/ticket.json',
    "cd .claude && cd driver && sed -i '' s/false/true/ plan.json",
    'cd .claude/driver && echo {} > plan.json',
    'patch .claude/driver/plan.json < p',
    'patch -p0 plan.json < p',
    'tar xf a.tar -C .claude/driver',
    'unzip -o a.zip -d .claude/driver',
    'install -m 644 x .claude/driver/plan.json',
    'ruby -i -pe 1 .claude/driver/plan.json',
    'perl -pi -e 1 plan.json',
    "awk -i inplace '1' .claude/driver/plan.json",
    'find .claude/driver -name plan.json -delete',
    'git reset --hard -- .claude/driver',
    'git checkout HEAD -- .claude/driver/plan.json',
    'git stash push -- .claude/driver',
    'git clean -fd .claude/driver',
    'rsync -a /tmp/d/ .claude/driver/',
    'ln -sf /tmp/x .claude/driver/plan.json',
    'mv plan.json /tmp/gone',
    'cd .claude/driver && rm -rf *',
    'rm -rf .claude',
    'echo x > ../other/events.jsonl',
    'echo x > ticket.json',
    'echo x > .mod/ticket.json',
  ])('files: %s', (c) => {
    expect(protectCommand(c)).toMatch(/written only by the driver CLI/);
  });

  it.each([
    'git reset --hard',
    'git reset --hard HEAD~1',
    'git checkout-index -af',
    'git update-index --assume-unchanged x',
    'git read-tree -u HEAD',
    'git stash',
    'git stash push',
    'git stash pop',
    'git -C . stash -u',
  ])('git rewrite: %s', (c) => {
    expect(protectCommand(c)).toMatch(/can rewrite \.claude\/driver/);
  });

  it.each([
    'ls .claude/driver/blocks/B-001.md | xargs -I{} cp {} .claude/driver/.mod/',
    'echo x | xargs cp /tmp/t .mod/ticket.json',
    'find . -name x | xargs -0 -n 1 rm plan.json',
    'echo a | xargs -I {} sh -c "cat > .mod/ticket.json"',
    'echo x | xargs driver gate approve route',
    'echo x | nohup xargs -n1 tee .mod/ticket.json',
  ])('xargs unwrapped: %s', (c) => {
    expect(protectCommand(c)).not.toBeNull();
  });

  it.each([
    '(sleep 1; echo yes; sleep 2) | script -q /dev/null bash x.sh',
    'script -q /dev/null bash x.sh',
    'script -q /dev/null driver gate approve route',
    'nohup script -q /dev/null ls',
    'expect x.exp',
    'expect -c "spawn node dist/cli.js foo"',
    'unbuffer ls',
    'socat - EXEC:ls,pty',
    `python3 -c 'import pty; pty.spawn(["bash","x.sh"])'`,
    `python3 -c 'import os; os.openpty()'`,
    'cc forkpty.c',
  ])('pty: %s', (c) => {
    expect(denied(c)).toBe(true);
  });

  it.each([
    'driver status',
    'driver where --json',
    'driver status --json',
    "driver apply --json <<< '{}'",
    'driver gate revoke route --reason x',
    'driver block status B-001 in_progress --owner a1',
    'driver block owner B-001 a2 --from a1',
    'node plugins/driver/dist/cli.js block add "T" --phase discover',
    'git status',
    'echo gate approve',
    'cat .claude/driver/plan.json',
    'jq .revision .claude/driver/plan.json',
    'ls .Claude/Driver/blocks',
    'node build.js',
    'jq . .claude/driver/plan.json > /tmp/x',
    'ls .claude/driverless.txt',
    'echo x > .claude/driverless.txt',
    'node ./bin/cli.js --port $PORT',
    'git commit -m "fix driver $bug"',
    'git add .claude/driver && git status && git log --oneline && git diff && git show HEAD',
    'echo x > .claude/driver/blocks/B-001.md',
    'cat .claude/driver/plan.json | jq .revision',
    'cd src && rm -rf dist/*',
    'cp .claude/driver/plan.json /tmp/backup.json',
    'tar cf out.tar .claude/driver',
    'git reset HEAD -- src/a.ts',
    'git reset --soft HEAD~1',
    'git stash list',
    'git stash show -p',
    'driver block status B-001 blocked --reason=--force',
  ])('allows: %s', (c) => {
    expect(protectCommand(c)).toBeNull();
  });
});
