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
  it('ends a command at a line break outside quotes, drops comments, keeps quoted and continued lines together', () => {
    expect(normalizeCommand('a # it\'s a comment\nb')).toBe('a ; b');
    expect(normalizeCommand('echo "x\ny" && ls')).toBe('echo x y && ls');
    expect(normalizeCommand('a \\\n  b')).toBe('a b');
    expect(normalizeCommand('echo $(( 1 << 2 ))\nls')).toBe('echo $(( 1 << 2 )) ; ls');
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
    "sed -i -e 's/.*/x/' .claude/driver/plan.json",
    "sed -i '' -e s/a/b/ -e s/c/d/ .claude/driver/plan.json",
    "sed -i 's/a/b/' .claude/driver/*.json",
    "perl -pi -e 's/.*/x/' .claude/driver/events.jsonl",
    "cd .claude/driver && sed -i '' 's/a/b/' *.json",
    "cd .claude/driver && sed -i '' 's/a/b/' log/REL-1.jsonl",
    "cd .claude/driver && sed -i '' 's/a/b/' $F",
    "cd .claude/driver && sed -i '' 's/a/b/'",
    "cd .claude/driver/discover && sed -i '' 's/a/b/' ../plan.json",
    "cd .claude/driver && perl -pi -e 's/a/b/' events.jsonl",
    // a sed script can write files (w, s///w) and GNU sed can run commands (e)
    "sed -i 's/a/b/w .claude/driver/plan.json' notes.md",
    "cd .claude/driver && sed -i 'w plan.json' discover/interview.md",
    "cd .claude/driver && sed -i -e 's/a/b/w events.jsonl' discover/interview.md",
    "sed -n 'w .claude/driver/plan.json' /dev/null",
    "sed -n '1e driver gate approve route' x",
    "sed -n '1w .claude/driver/plan.json' x",
    "sed -n '$w .claude/driver/plan.json' x",
    "sed -n '1,3w .claude/driver/plan.json' x",
    "cd .claude/driver && sed -i '$w events.jsonl' discover/interview.md",
    "sed -n '1e x=dri; ${x}ver gate approve route' x",
    "sed -n '/./e date' x",
    "sed 's/.*/date/e' x",
    'cd .claude/driver && sed -i "s/$X/b/" discover/interview.md',
    "sed -l 5 'w .claude/driver/plan.json' x",
    'rm .claude/driver/pl{a..a}n.json',
    'cd .claude/skills && cd ../driver && rm *',
    'D=.claude/driver; cd $D && rm *',
    // perl and ruby code is arbitrary
    `cd .claude/driver && perl -i -pe 'BEGIN{unlink "plan.json"}' discover/interview.md`,
    // a script glued to its flag does not hide the target
    'sed -i -es/a/b/ .claude/driver/plan.json',
    'sed -i -fscript.sed .claude/driver/plan.json',
    'perl -pi -es/a/b/ .claude/driver/plan.json',
    'ruby -pi -es/a/b/ .claude/driver/plan.json',
    // BSD -I and GNU --in-place=SUFFIX
    "sed -I '' s/a/b/ .claude/driver/plan.json",
    'sed -I.bak s/a/b/ .claude/driver/plan.json',
    'sed --in-place=.bak s/a/b/ .claude/driver/plan.json',
    // operands the shell expands
    'cd .claude/driver && sed -i s/a/b/ {plan,x}.json',
    'rm .claude/driver/{plan,x}.json',
    'cd .claude/driver && sed -i s/a/b/ log/foo.jsonl',
    // a cd that ends in the plan dir by another route
    'cd .claude/driver/discover && cd .. && sed -i s/a/b/ *',
    'pushd .claude/driver && sed -i s/a/b/ *',
    'cd .claude/driver/discover && sed -i s/a/b/ ../*',
    // bracket classes the glob translation does not model
    'rm .claude/driver/pl[]a]n.json',
    'rm .claude/driver/[[:lower:]]lan.json',
    'jq .revision=9 .claude/driver/plan.json > t && mv t .claude/driver/plan.json',
    'tee .claude/driver/events.jsonl < x',
    'cp /tmp/x .claude/driver/plan.json',
    'rm .claude/driver/events.jsonl',
    'truncate -s 0 .claude/driver/events.jsonl',
    'cd .claude/driver && echo {} > plan.json',
    'cd .claude/driver && cp /tmp/x plan.json',
    'git checkout -- .claude/driver/plan.json',
    'git restore .claude/driver/plan.json',
    'jq . x | sponge .claude/driver/plan.json',
    'dd if=/tmp/x of=.claude/driver/plan.json',
    'echo {} > .claude/./driver/plan.json',
    'echo {} > .claude//driver/plan.json',
    'echo {} > ".claude/driver"/plan.json',
    'echo {} > .claude/dri\\ver/plan.json',
    'rm .claude/driver/log/REL-1.jsonl',
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
    `node -e "require('fs').writeFileSync('.claude/driver/plan.json','{}')"`,
    `python3 -c "open('.claude/driver/plan.json','w').write('{}')"`,
    'perl -e 1 .claude/driver/plan.json',
    // PER-619: a heredoc read by an interpreter is the same inline script
    `python3 - <<'EOF'\nopen('.claude/driver/plan.json','w').write('{}')\nEOF`,
    `node - <<EOF\nrequire('fs').unlinkSync('.claude/driver/events.jsonl')\nEOF`,
    `cd .claude/driver && python3 - <<'EOF'\nprint(1)\nEOF`,
    `cat <<'EOF' | node -\nfs.writeFileSync('plan.json', '{}')\nEOF`,
    // perl and ruby take the code in a flag cluster
    `perl -pe 'BEGIN{open F,">.claude/driver/plan.json"}' x`,
    `ruby -i -pe 'File.write(".claude/driver/plan.json","")' x`,
  ])('inline script: %s', (c) => {
    expect(protectCommand(c)).toMatch(/inline script mentions/);
  });

  // PER-619: `$`, backticks and parens are only suspicious where they stand for a command
  it.each([
    '$CMD $ARGS',
    '`which driver` status',
    '$(cat /tmp/c)',
    'cd x && ${D} status',
    // code handed to a shell must be readable here
    'X=1; eval "$X"',
    'bash -c "$CMD"',
    `eval "$(cat <<'EOF'\necho hi\nEOF\n)"`,
    `eval "$(cat <<'EOF'\ndriver gate approve route\nEOF\n)"`,
    // the loop runs each body line: `$l` is an opaque command
    `while read l; do $l; done <<'EOF'\ndriver gate approve route\nEOF`,
  ])('opaque command name: %s', (c) => {
    expect(protectCommand(c)).toMatch(/cannot be checked/);
  });

  it.each([
    '(driver rebaseline --reason x)',
    '( driver gate approve route )',
    '{ driver gate approve route; }',
    '$(cat cmd) gate approve route',
    'driver block status B-003 done $(echo --force)',
    // heredoc bodies a shell runs
    `bash <<'EOF'\ndriver gate approve route\nEOF`,
    `cat <<'EOF' | bash\ndriver rebaseline --reason x\nEOF`,
    `zsh -s <<EOF\ncd plugins/driver/dist && node cli.js gate approve route\nEOF`,
    // the shell expands substitutions in an unquoted body before the command reads it
    `cat <<EOF\n$(driver gate approve route)\nEOF`,
    'cat <<EOF\n`driver rebaseline --reason x`\nEOF',
    // xargs makes the body the arguments of the wrapped command
    `xargs driver <<'EOF'\ngate approve route\nEOF`,
    `echo x | xargs node dist/cli.js <<'EOF'\nblock status B-001 done --force\nEOF`,
    // a `<<` inside quotes or a comment opens nothing: the next lines are still commands
    `echo "x <<EOF"\ndriver gate approve route`,
    `true # <<EOF\ndriver gate approve route`,
    `echo \\<<EOF\ndriver gate approve route`,
    // a new line is a new command, and a heredoc hides only its own body
    'echo hi\ndriver gate approve route',
    `cat <<'EOF'\nhello\nEOF\ndriver gate approve route`,
    'driver gate \\\n approve route',
    `bash <<'EOF'\necho hi\ndriver gate approve route\nEOF`,
    // things that look like heredoc openers but are not, so the next line is still a command
    'echo $(( 1 << 2 ))\ndriver gate approve route',
    '(( x = 1 << 3 ))\ndriver gate approve route',
    'echo "a\nb <<EOF"\ndriver gate approve route',
    "# it's\ndriver gate approve route",
    // the delimiter is read with quote removal, like bash does
    `cat <<E"OF"\nx\nEOF\ndriver gate approve route`,
    `cat <<EO\\F\nx\nEOF\ndriver gate approve route`,
    // bodies that end up executed
    `exec 3<<'EOF'\ndriver gate approve route\nEOF\nbash <&3`,
    `source /dev/stdin <<'EOF'\ndriver gate approve route\nEOF`,
    `while read a b c; do driver $a $b $c; done <<'EOF'\ngate approve route\nEOF`,
    // keywords in front of the command
    'if true; then driver gate approve route; fi',
    '! driver rebaseline --reason x',
    'until false; do driver gate approve route; done',
    'driver gate --via"-"mod approve route',
    // second review: comments, continued lines, delimiters, readers
    'echo a\\ #; driver gate approve route',
    'echo ${x// #/} && driver gate approve route',
    `cat <<'EOF' \\\n| bash\ndriver gate approve route\nEOF`,
    `cat <<'EOF' |\ndriver gate approve route\nEOF\nbash`,
    `cat <<"E\\OF"\nx\nE\\OF\ndriver gate approve route`,
    `cat <<$'EOF'\nx\nEOF\ndriver gate approve route`,
    `x=$(cat <<'EOF'\nhi\nEOF)\ndriver gate approve route`,
    'echo ${x:-<<EOF}\ndriver gate approve route',
    'echo $[x<<y]\ndriver gate approve route',
    'for((i=0;i<x<<y;i++)); do :; done\ndriver gate approve route',
    "echo $'a\\'b'\ndriver gate approve route",
    `tee >(bash) <<'EOF'\ndriver gate approve route\nEOF`,
    `cat <<'EOF' > >(sh)\ndriver gate approve route\nEOF`,
    `parallel <<'EOF'\ndriver gate approve route\nEOF`,
    `python3 - <<-'EOF'\n\tprint(1)\n\tEOF\ndriver gate approve route`,
    `cat <<'A' <<B\nx\nA\n$(driver gate approve route)\nB`,
    // substitutions in argument position run too
    'echo $(driver gate approve route)',
    'x=`driver rebaseline --reason x`',
    // wrappers with options, case patterns, functions, case-insensitive names
    'sudo -E driver gate approve route',
    'env -i PATH=/x driver gate approve route',
    'nice -n 5 driver gate approve route',
    'timeout 9 node dist/cli.js gate approve route',
    'case x in x) driver gate approve route;; esac',
    'f() { driver gate approve route; }; f',
    'function f { driver gate approve route; }',
    'Driver gate approve route',
    // third pass: arithmetic after keywords and in subscripts, wrapper flags, case/function forms, process substitution
    'while((x<<y)); do :; done\ndriver gate approve route',
    'if((1)); then :; fi\ndriver gate approve route',
    'a[1<<2]=3\ndriver gate approve route',
    'env -i driver gate approve route',
    'exec -a x driver gate approve route',
    'case x in (x) driver gate approve route;; esac',
    'f(){ driver gate approve route;}; f',
    'f() (driver gate approve route)',
    'echo <(driver gate approve route)',
    'cat >(driver gate approve route)',
    "echo ${x:-'}'}\ndriver gate approve route",
    'bash -c "driver gate approve route"',
    "sh -c 'driver rebaseline --reason x'",
    // fourth pass: quoted code reaching a shell, and `[` or `[[` as plain arguments
    "find . -exec sh -c 'true; driver gate approve route' \\;",
    "su -c 'true; driver gate approve route'",
    "watch 'true; driver gate approve route'",
    "git -c alias.x='!true; driver gate approve route' x",
    "printf '%s\\n' 'true; driver gate approve route' | sh",
    "echo 'true; driver gate approve route' > /dev/stdin | bash",
    "bash -lc 'true; driver gate approve route'",
    'echo a[ ; driver gate approve route',
    'echo x[1; driver gate approve route',
    'echo [[ ; driver gate approve route',
    'echo [[x; driver gate approve route',
    'echo a[ && driver gate approve route',
    'a[x]=1 driver gate approve route',
    `echo "\${x:-'}"; driver gate approve route`,
    // more things that run a quoted argument as code
    "npx -c 'true; driver gate approve route'",
    "npm exec -c 'true; driver gate approve route'",
    "tmux new -d 'true; driver gate approve route'",
    "make SHELL=sh -f /dev/null --eval 'x:; driver gate approve route' x",
    "git -c core.sshCommand='true; driver gate approve route' fetch",
    "printf 'true; driver gate approve route' | source /dev/stdin",
  ])('user-only (parens, substitution, heredoc): %s', (c) => {
    expect(protectCommand(c)).toMatch(/user-only/);
  });

  it.each([
    `sh <<'EOF'\ncd .claude/driver && rm plan.json\nEOF`,
    `tee .claude/driver/plan.json <<'EOF'\n{}\nEOF`,
    `cat <<'EOF' > .claude/driver/plan.json\n{}\nEOF`,
    `cat <<'EOF' >> .claude/driver/events.jsonl\n{}\nEOF`,
    `cat <<EOF\n$(rm .claude/driver/plan.json)\nEOF`,
    'echo a\\ #; rm .claude/driver/plan.json',
    // a patch names what it rewrites; the cd context survives into a recursed body
    `git apply <<'EOF'\n--- a/.claude/driver/plan.json\n+++ b/.claude/driver/plan.json\nEOF`,
    `patch -p1 <<'EOF'\n--- a/.claude/driver/plan.json\n+++ b/.claude/driver/plan.json\nEOF`,
    `cd .claude/driver && bash <<'EOF'\nrm -rf *\nEOF`,
    // code handed to a shell is judged as the commands it is, separators inside the quotes included
    'sh -c "cd .claude/driver; rm plan.json"',
    "eval 'cd .claude/driver && rm plan.json'",
  ])('files via heredoc: %s', (c) => {
    expect(protectCommand(c)).toMatch(/written only by the driver CLI/);
  });

  it.each([
    `python3 - <<'EOF'\nimport pty; pty.spawn(["bash"])\nEOF`,
    `bash <<'EOF'\nscript -q /dev/null driver gate approve route\nEOF`,
  ])('pty via heredoc: %s', (c) => {
    expect(protectCommand(c)).toMatch(/pseudo-terminal/);
  });

  it.each([
    // the PER-619 repro: code in a quoted heredoc is text, not commands
    `python3 - <<'EOF'\nimport re\np = 'plugins/driver/test/rows.spec.ts'\ns = open(p).read()\ns = s.replace("a", "expect(rows[0]!.text).toMatch(/^↑ \\\\d+ more$/);")\nopen(p, 'w').write(s)\nEOF`,
    `cat <<'EOF' > /tmp/x.ts\nexpect(rows[0]!.text).toMatch(/^↑ \\d+ more$/);\nconst s = \`\${a}\`;\nif (ok) { run(\$(x)); }\nEOF`,
    `node - <<'EOF'\nconsole.log(process.env.HOME, \`\${1 + 1}\`)\nEOF`,
    // an unquoted body is expanded, but these expansions run nothing of ours
    `cat <<EOF > /tmp/notes.md\nHome: $HOME, date: $(date), see plan.json in the DRIVER repo\nEOF`,
    // a quoted body is never expanded, so a substitution in it is text
    `cat <<'EOF' > /tmp/x.sh\n$(driver gate approve route)\nEOF`,
    `python3 - <<-'EOF'\n\tprint("gate approve is user-only")\n\tEOF\nls`,
    // two heredocs on one line, bodies in order
    `cat <<'A' <<'B'\n$(x)\nA\n\`y\`\nB`,
    // here-strings are not heredocs
    "driver apply --json <<< '{\"ops\":[]}'",
    // the driver CLI may read protected names from its own stdin
    `node plugins/driver/dist/cli.js apply --json <<'EOF'\n{"ops":[{"op":"block.add","title":"fix plan.json export"}]}\nEOF`,
    // the commit-message idiom: a heredoc opened inside "$( … )" is still a heredoc, read by cat
    `git commit -m "$(cat <<'EOF'\nfeat: gate approve via mod\n\n- driver rebaseline --reason x documented\nEOF\n)"`,
    `git add . && git commit -m "$(cat <<'EOF'\nfeat: x\n\ndriver gate approve route is user-only now\nEOF\n)"`,
    'echo "two\nlines" && ls',
    // second review: arithmetic, literal single-quoted code, escapes in unquoted bodies
    'if (( $x > 1 )); then echo big; fi',
    '(( $# > 0 )) && echo ok',
    "bash -c 'echo $HOME'",
    "echo hi | xargs -I{} sh -c 'echo $0 {}'",
    `x=$((1<<2)); cat <<'EOF' > f.sh\n$HOME stuff\nEOF`,
    `cat <<EOF > f.txt\ncount: $(( $n + 1 ))\nEOF`,
    `cat <<EOF | tee f.txt\n\\$HOME\nEOF`,
    "echo '$(driver gate approve route)'",
    'source ~/.nvm/nvm.sh',
    'source $F',
    // separators inside quotes, `[[ ]]`, `(( ))` and `${ }` do not split commands
    'git commit -m "fix: guard; driver gate approve route is user-only"',
    `echo "$(ls | grep -E '(a|b)$')"`,
    '[[ $x =~ ^(a|b)$ ]] && echo y',
    "grep -E 'a|(b)$' x.txt",
    "sed -E 's/(foo|bar)$/x/' a.txt",
    '(( a || b )) && echo z',
    'echo ${x:-a|b}',
    'env -i PATH=/x ls',
    'diff <(ls a) <(ls b)',
    'timeout 5 npm test',
    // quoted blanks keep an argument whole; a quoted string is code only when something runs code
    'git commit -m "feat: x; y and z"',
    'driver block add "Fix gate approve copy" --phase discover',
    "jq '.a | .b' x.json",
    "awk -F'|' '{print $1}' x.csv",
    'curl "https://x.test/a?b=1&c=2"',
    'arr[0]=1; echo ${arr[0]}',
    '[[ -f x ]] && echo ok',
    "ssh host 'ls; pwd'",
    // a quoted line break is not a new command (and a commit message is not a shell script)
    'git commit -m "feat: x\n\n- driver gate approve route documented"',
    // arithmetic shifts are not heredocs
    'echo $(( 1 << 2 ))',
    '(( x = 1 << 3 )); echo $x',
    // a bare `$` in an argument of an ordinary command, or a heredoc read in a loop
    `while read l; do echo "$l"; done <<'EOF'\ngate approve route\nEOF`,
    'bash scripts/deploy.sh $ENV',
    // parens and `$` in ordinary commands
    'grep -E "^(esbuild|tsx)" plugins/driver/package.json',
    '(cd plugins/driver && echo $HOME)',
    'echo $(date) > /tmp/now',
    'FOO=$(pwd); echo $FOO',
    'git log --format="%h %s" | grep -E "fix\\(.*\\)"',
    // the script of an in-place editor is not a path: `.*` is a regex, not a glob over .mod
    "sed -i '' '5s/.*/x/' .claude/GUARDRAILS.md",
    "sed -i -e 's/.*/x/' .claude/docs/STACK.md",
    "perl -pi -e 's/.*/x/' .claude/GUARDRAILS.md",
    "ruby -i -pe 'gsub(/.*/, \"x\")' .claude/GUARDRAILS.md",
    // after a cd into the plan dir, an in-place edit of a named unprotected file
    "cd .claude/driver && sed -i '' 's/^a$/b/' discover/interview.md",
    "cd .claude/driver/discover && sed -i '' 's/^round: 2$/round: 3/' interview.md",
    "sed -n '/plan.json/p' notes.md",
    "sed -n 's/plan.json/x/p;/where/p' docs/x.md",
    "cd .claude/driver && sed -n '/wanted/p' discover/interview.md",
    'mkdir -p src/{a,b}',
    'rm -rf dist/{a,b}',
    'git commit -m "fix(protect): x"',
    'cd log && rm old.txt',
    "sed -i '' 's/new world/x/' notes.md",
    "sed -E 's/(a|b)+/x/' notes.md",
    "perl -pe 's/a/b/' notes.md",
    // a bracket that is no valid glob class used to throw inside the guard; the shell reads it literally
    'rm .claude/driver/[p-a]lan.json',
    String.raw`sed -n '/^## \[ADR-012\]/,/^### Contexto/p' /x/.claude/docs/DECISIONS.md | head -5`,
  ])('allows (PER-619): %s', (c) => {
    expect(protectCommand(c)).toBeNull();
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
