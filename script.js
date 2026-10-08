(() => {
    const $ = id => document.getElementById(id);
    const drop = $('drop'), input = $('file'), statusEl = $('status');
    let lastBlob = null, lastName = '';

    const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
    const farCoord = () => (Math.random() < 0.5 ? -1 : 1) * rnd(3000, 8000);
    const used = new Set();

    function genName() {
        let n;
        do {
            const style = rnd(0, 2);
            if (style === 0) {
                const chars = 'l1I';
                n = 'l';
                for (let i = rnd(5, 9); i > 0; i--) n += chars[rnd(0, 2)];
            } else if (style === 1) n = 'x_' + rnd(100, 99999);
            else n = 'a' + rnd(1, 99999);
        } while (used.has(n));
        used.add(n);
        return n;
    }

    const ID_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const newBlockId = blocks => {
        let s;
        do { s = Array.from({ length: 20 }, () => ID_CHARS[rnd(0, ID_CHARS.length - 1)]).join(''); } while (blocks[s]);
        return s;
    };

    function unsafeToMove(blocks, id, followNext) {
        const b = blocks[id];
        if (!b || Array.isArray(b)) return false;
        if (b.opcode.startsWith('argument_reporter')) return true;
        if (b.opcode === 'control_stop' && b.fields && b.fields.STOP_OPTION && b.fields.STOP_OPTION[0] === 'this script') return true;
        for (const inp of Object.values(b.inputs || {}))
            for (const e of inp) if (typeof e === 'string' && unsafeToMove(blocks, e, true)) return true;
        return followNext && b.next ? unsafeToMove(blocks, b.next, true) : false;
    }

    function chunkScripts(t, minLen, maxLen) {
        const blocks = t.blocks || {};
        let created = 0;
        const tops = Object.keys(blocks).filter(id => !Array.isArray(blocks[id]) && blocks[id].topLevel);
        for (const topId of tops) {
            const chain = [];
            for (let cur = blocks[topId].next; cur; cur = blocks[cur].next) chain.push(cur);
            if (chain.length === 0) continue;

            const items = [];
            for (let i = 0; i < chain.length;) {
                const seg = chain.slice(i, i + rnd(minLen, maxLen));
                i += seg.length;
                if (seg.some(id => unsafeToMove(blocks, id, false))) { items.push(...seg); continue; }
                const proccode = genName();
                const defId = newBlockId(blocks);
                blocks[defId] = { opcode: 'procedures_definition', next: seg[0], parent: null, inputs: {}, fields: {}, shadow: false, topLevel: true, x: 0, y: 0 };
                const protoId = newBlockId(blocks);
                blocks[protoId] = {
                    opcode: 'procedures_prototype', next: null, parent: defId, inputs: {}, fields: {}, shadow: true, topLevel: false,
                    mutation: { tagName: 'mutation', children: [], proccode, argumentids: '[]', argumentnames: '[]', argumentdefaults: '[]', warp: 'false' }
                };
                blocks[defId].inputs.custom_block = [1, protoId];
                const callId = newBlockId(blocks);
                blocks[callId] = {
                    opcode: 'procedures_call', next: null, parent: null, inputs: {}, fields: {}, shadow: false, topLevel: false,
                    mutation: { tagName: 'mutation', children: [], proccode, argumentids: '[]', warp: 'false' }
                };
                blocks[seg[0]].parent = defId;
                blocks[seg[seg.length - 1]].next = null;
                items.push(callId);
                created++;
            }
            let prev = topId;
            for (const id of items) { blocks[prev].next = id; blocks[id].parent = prev; prev = id; }
            blocks[prev].next = null;
        }
        return created;
    }

    function obfuscate(project, opts = {}) {
        used.clear();
        const stats = { vars: 0, lists: 0, scripts: 0, pieces: 0, broadcasts: 0, procs: 0, numRefs: 0, bcastSkipped: false, assets: 0, decoys: 0, skipped: [] };
        const targets = project.targets || [];
        const stage = targets.find(t => t.isStage);
        const idMap = new Map();
        const nameMaps = new Map();
        const stageNames = new Map();

        for (const t of targets) {
            const nm = new Map();
            nameMaps.set(t, nm);
            for (const [id, v] of Object.entries(t.variables || {})) {
                const cloud = v[2] === true || String(v[0]).startsWith('☁');
                const nn = (cloud ? '☁ ' : '') + genName();
                nm.set(v[0], nn);
                if (t.isStage) stageNames.set(v[0], nn);
                idMap.set(id, nn);
                v[0] = nn;
                stats.vars++;
            }
            for (const [id, l] of Object.entries(t.lists || {})) {
                idMap.set(id, genName());
                l[0] = idMap.get(id);
                stats.lists++;
            }
        }

        if (opts.procs) {
            for (const t of targets) {
                const B = Object.values(t.blocks || {}).filter(b => !Array.isArray(b));
                const pmap = new Map(), amap = new Map();
                const an = n => { if (!amap.has(n)) amap.set(n, genName()); return amap.get(n); };
                for (const b of B) if (b.opcode === 'procedures_prototype' && b.mutation) {
                    const m = b.mutation, old = m.proccode;
                    if (!pmap.has(old)) {
                        pmap.set(old, old.split(' ').map(w => /^%[sbn]$/.test(w) ? w : genName()).join(' '));
                        stats.procs++;
                    }
                    try { m.argumentnames = JSON.stringify(JSON.parse(m.argumentnames).map(an)); } catch (e) { }
                }
                for (const b of B) {
                    if ((b.opcode === 'procedures_prototype' || b.opcode === 'procedures_call') && b.mutation && pmap.has(b.mutation.proccode))
                        b.mutation.proccode = pmap.get(b.mutation.proccode);
                    if (b.opcode.startsWith('argument_reporter') && b.fields && b.fields.VALUE && amap.has(b.fields.VALUE[0]))
                        b.fields.VALUE[0] = amap.get(b.fields.VALUE[0]);
                }
            }
        }

        const bMap = new Map(), bNames = new Map();
        if (opts.bcast) {
            let dynamic = false;
            for (const t of targets) for (const b of Object.values(t.blocks || {})) {
                if (Array.isArray(b) || (b.opcode !== 'event_broadcast' && b.opcode !== 'event_broadcastandwait')) continue;
                const i = b.inputs && b.inputs.BROADCAST_INPUT;
                if (Array.isArray(i) && typeof i[1] === 'string' && t.blocks[i[1]] && t.blocks[i[1]].opcode !== 'event_broadcast_menu') dynamic = true;
            }
            if (dynamic) stats.bcastSkipped = true;
            else for (const t of targets) for (const [id, name] of Object.entries(t.broadcasts || {})) {
                const k = String(name).toLowerCase();
                if (!bNames.has(k)) { bNames.set(k, genName()); stats.broadcasts++; }
                bMap.set(id, bNames.get(k));
                t.broadcasts[id] = bNames.get(k);
            }
        }

        if (opts.chunk) {
            const [mn, mx] = (opts.level || '2-3').split('-').map(Number);
            for (const t of targets) stats.pieces += chunkScripts(t, mn, mx);
        }

        if (opts.decoys) {
            for (const t of targets) {
                const B = t.blocks = t.blocks || {};
                const pool = t.isStage
                    ? [() => ['control_wait', { DURATION: [1, [5, String(rnd(1, 9))]] }]]
                    : [() => ['motion_movesteps', { STEPS: [1, [4, String(rnd(-90, 90))]] }],
                    () => ['motion_turnright', { DEGREES: [1, [4, String(rnd(1, 180))]] }],
                    () => ['motion_changexby', { DX: [1, [4, String(rnd(-50, 50))]] }],
                    () => ['looks_say', { MESSAGE: [1, [10, genName()]] }],
                    () => ['control_wait', { DURATION: [1, [5, String(rnd(1, 9))]] }]];
                for (let n = rnd(4, 10); n > 0; n--) {
                    let prev = null;
                    for (let i = rnd(2, 5); i > 0; i--) {
                        const [op, inputs] = pool[rnd(0, pool.length - 1)]();
                        const id = newBlockId(B);
                        B[id] = { opcode: op, next: null, parent: prev, inputs, fields: {}, shadow: false, topLevel: prev === null };
                        if (prev) B[prev].next = id; else { B[id].x = 0; B[id].y = 0; }
                        prev = id; stats.decoys++;
                    }
                }
            }
        }

        const renameRef = (arr, ni, ii, t) => {
            const id = arr[ii];
            let nn = idMap.get(id);
            if (!nn) nn = nameMaps.get(t)?.get(arr[ni]) ?? stageNames.get(arr[ni]);
            if (nn) arr[ni] = nn;
        };
        const renameB = (arr, ni, ii) => {
            const nn = bMap.get(arr[ii]) ?? bNames.get(String(arr[ni]).toLowerCase());
            if (nn) arr[ni] = nn;
        };
        const walk = (x, t) => {
            if (!Array.isArray(x)) return;
            if (x[0] === 11 && typeof x[1] === 'string' && typeof x[2] === 'string') renameB(x, 1, 2);
            else if ((x[0] === 12 || x[0] === 13) && typeof x[1] === 'string' && typeof x[2] === 'string') {
                renameRef(x, 1, 2, t);
            } else x.forEach(e => walk(e, t));
        };

        for (const t of targets) {
            const blocks = t.blocks || {};
            for (const b of Object.values(blocks)) {
                if (Array.isArray(b)) {
                    if (b[0] === 12 || b[0] === 13) renameRef(b, 1, 2, t);
                    if (b.length >= 5) { b[3] = farCoord(); b[4] = farCoord(); stats.scripts++; }
                    continue;
                }
                if (b.topLevel) { b.x = farCoord(); b.y = farCoord(); stats.scripts++; }

                for (const key of ['VARIABLE', 'LIST']) {
                    const f = b.fields && b.fields[key];
                    if (Array.isArray(f) && f.length >= 2) renameRef(f, 0, 1, t);
                }
                const bo = b.fields && b.fields.BROADCAST_OPTION;
                if (Array.isArray(bo) && bo.length >= 2) renameB(bo, 0, 1);
                for (const inp of Object.values(b.inputs || {})) walk(inp, t);

                if (b.opcode === 'sensing_of' && b.fields && Array.isArray(b.fields.PROPERTY)) {
                    const menuId = Array.isArray(b.inputs?.OBJECT) ? b.inputs.OBJECT[1] : null;
                    const objName = menuId && blocks[menuId] && blocks[menuId].fields?.OBJECT?.[0];
                    const target = objName === '_stage_' ? stage : targets.find(x => !x.isStage && x.name === objName);
                    const nn = target && nameMaps.get(target)?.get(b.fields.PROPERTY[0]);
                    if (nn) b.fields.PROPERTY[0] = nn;
                }
            }
        }
        if (opts.nums && stage) {
            const numVars = new Map();
            const getVar = val => {
                if (!numVars.has(val)) {
                    const id = newBlockId(stage.variables), nm = genName();
                    stage.variables[id] = [nm, val];
                    numVars.set(val, [nm, id]);
                }
                return numVars.get(val);
            };
            for (const t of targets) for (const b of Object.values(t.blocks || {})) {
                if (Array.isArray(b) || b.shadow || b.opcode === 'procedures_prototype') continue;
                for (const inp of Object.values(b.inputs || {})) {
                    const lit = inp[1];
                    if (inp[0] === 1 && Array.isArray(lit) && lit[0] >= 4 && lit[0] <= 8 && typeof lit[1] === 'string'
                        && lit[1].trim() !== '' && isFinite(Number(lit[1]))) {
                        const [nm, id] = getVar(lit[1]);
                        inp[0] = 3; inp[2] = lit; inp[1] = [12, nm, id];
                        stats.numRefs++;
                    }
                }
            }
            for (let i = rnd(6, 14); i > 0; i--)
                stage.variables[newBlockId(stage.variables)] = [genName(), String(rnd(0, 99999))];
        }
        for (const m of project.monitors || []) {
            if (!m.params) continue;
            const nn = idMap.get(m.id);
            if (!nn) continue;
            if ('VARIABLE' in m.params) m.params.VARIABLE = nn;
            if ('LIST' in m.params) m.params.LIST = nn;
        }

        if (opts.assets) {
            const DYN = {
                motion_goto: ['TO', 'sp'], motion_glideto: ['TO', 'sp'], motion_pointtowards: ['TOWARDS', 'sp'],
                sensing_touchingobject: ['TOUCHINGOBJECTMENU', 'sp'], sensing_distanceto: ['DISTANCETOMENU', 'sp'],
                control_create_clone_of: ['CLONE_OPTION', 'sp'], sensing_of: ['OBJECT', 'sp'],
                looks_switchcostumeto: ['COSTUME', 'co'], looks_switchbackdropto: ['BACKDROP', 'co'],
                looks_switchbackdroptoandwait: ['BACKDROP', 'co'], sound_play: ['SOUND_MENU', 'so'], sound_playuntildone: ['SOUND_MENU', 'so']
            };
            const MENU = {
                motion_goto_menu: ['TO', 'sp'], motion_glideto_menu: ['TO', 'sp'], motion_pointtowards_menu: ['TOWARDS', 'sp'],
                sensing_touchingobjectmenu: ['TOUCHINGOBJECTMENU', 'sp'], sensing_distancetomenu: ['DISTANCETOMENU', 'sp'],
                control_create_clone_of_menu: ['CLONE_OPTION', 'sp'], sensing_of_object_menu: ['OBJECT', 'sp'],
                looks_costume: ['COSTUME', 'co'], looks_backdrops: ['BACKDROP', 'co'], sound_sounds_menu: ['SOUND_MENU', 'so']
            };
            const dyn = { sp: false, co: false, so: false };
            for (const t of targets) for (const b of Object.values(t.blocks || {})) {
                if (Array.isArray(b) || b.shadow) continue;
                const d = DYN[b.opcode], inp = d && b.inputs && b.inputs[d[0]];
                if (Array.isArray(inp) && typeof inp[1] === 'string' && t.blocks[inp[1]] && !t.blocks[inp[1]].shadow) dyn[d[1]] = true;

                if ((b.opcode === 'looks_costumenumbername' || b.opcode === 'looks_backdropnumbername') && b.fields.NUMBER_NAME && b.fields.NUMBER_NAME[0] === 'name') dyn.co = true;
                if (b.opcode === 'sensing_of' && b.fields.PROPERTY && /^(costume|backdrop) name$/.test(b.fields.PROPERTY[0])) dyn.co = true;
            }
            const maps = { sp: new Map(), co: new Map(), so: new Map() };
            const ren = (k, old) => { const m = maps[k]; if (!m.has(old)) { m.set(old, genName()); stats.assets++; } return m.get(old); };
            if (!dyn.sp) for (const t of targets) if (!t.isStage) t.name = ren('sp', t.name);
            if (!dyn.co) for (const t of targets) for (const c of t.costumes || []) c.name = ren('co', c.name);
            if (!dyn.so) for (const t of targets) for (const c of t.sounds || []) c.name = ren('so', c.name);
            for (const t of targets) for (const b of Object.values(t.blocks || {})) {
                const m = !Array.isArray(b) && MENU[b.opcode];
                const f = m && !dyn[m[1]] && b.fields && b.fields[m[0]];
                if (Array.isArray(f) && maps[m[1]].has(f[0])) f[0] = maps[m[1]].get(f[0]);
            }
            for (const m of project.monitors || []) if (m.spriteName && maps.sp.has(m.spriteName)) m.spriteName = maps.sp.get(m.spriteName);
            if (dyn.sp) stats.skipped.push('sprites');
            if (dyn.co) stats.skipped.push('costumes/backdrops');
            if (dyn.so) stats.skipped.push('sounds');
        }

        if (opts.comments) for (const t of targets) {
            t.comments = {};
            for (const b of Object.values(t.blocks || {})) if (!Array.isArray(b)) delete b.comment;
        }

        if (opts.ids) for (const t of targets) {
            const old = t.blocks || {}, map = new Map(), taken = new Set(), nb = {};
            const nid = () => { let r; do { r = Array.from({ length: 20 }, () => ID_CHARS[rnd(0, ID_CHARS.length - 1)]).join(''); } while (taken.has(r)); taken.add(r); return r; };
            Object.keys(old).forEach(k => map.set(k, nid()));
            for (const k of Object.keys(old).sort(() => Math.random() - 0.5)) {
                const b = old[k];
                if (!Array.isArray(b)) {
                    if (b.next) b.next = map.get(b.next) ?? b.next;
                    if (b.parent) b.parent = map.get(b.parent) ?? b.parent;
                    for (const inp of Object.values(b.inputs || {}))
                        for (let i = 1; i < inp.length; i++) if (typeof inp[i] === 'string' && map.has(inp[i])) inp[i] = map.get(inp[i]);
                }
                nb[map.get(k)] = b;
            }
            t.blocks = nb;
            for (const c of Object.values(t.comments || {})) if (c.blockId && map.has(c.blockId)) c.blockId = map.get(c.blockId);
        }
        return stats;
    }

    function show(html, err) {
        statusEl.style.display = 'block';
        statusEl.className = err ? 'err' : '';
        statusEl.innerHTML = html;
    }

    function download(blob, name) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
    }

    async function handle(file) {
        if (!file) return;
        if (!/\.sb3$/i.test(file.name)) return show('Select a file with the <b>.sb3</b> extension.', true);
        if (typeof JSZip === 'undefined') return show('Could not load the JSZip library. Check your connection.', true);
        show('Processing <b>' + file.name.replace(/[<>&]/g, '') + '</b>…');
        try {
            const zip = await JSZip.loadAsync(file);
            const entry = zip.file('project.json');
            if (!entry) throw new Error('project.json not found inside the .sb3.');
            const project = JSON.parse(await entry.async('string'));
            const stats = obfuscate(project, { chunk: $('chunk').checked, level: $('chunkLevel').value, bcast: $('bcast').checked, nums: $('nums').checked, procs: $('procs').checked, assets: $('assets').checked, decoys: $('decoys').checked, comments: $('comments').checked, ids: $('ids').checked });
            zip.file('project.json', JSON.stringify(project));
            lastBlob = await zip.generateAsync({
                type: 'blob', mimeType: 'application/x.scratch.sb3',
                compression: 'DEFLATE', compressionOptions: { level: 9 }
            });
            lastName = file.name.replace(/\.sb3$/i, '') + '_obfuscated.sb3';
            download(lastBlob, lastName);
            show(`Done! The download of <b>${lastName.replace(/[<>&]/g, '')}</b> has started.
        <div class="stats">
          <div class="stat"><strong>${stats.vars}</strong><span>variables</span></div>
          <div class="stat"><strong>${stats.lists}</strong><span>lists</span></div>
          <div class="stat"><strong>${stats.assets}</strong><span>sprites/costumes/sounds</span></div>
          <div class="stat"><strong>${stats.decoys}</strong><span>decoy blocks</span></div>
          <div class="stat"><strong>${stats.broadcasts}</strong><span>broadcasts</span></div>
          <div class="stat"><strong>${stats.procs}</strong><span>renamed blocks</span></div>
          <div class="stat"><strong>${stats.numRefs}</strong><span>numbers → variables</span></div>
          <div class="stat"><strong>${stats.pieces}</strong><span>chunks created</span></div>
          <div class="stat"><strong>${stats.scripts}</strong><span>scattered scripts</span></div>
        </div>
        ${stats.skipped.length ? '<p>⚠ Not renamed (the project uses names computed at runtime or reads the costume name): ' + stats.skipped.join(', ') + '.</p>' : ''}
        ${stats.bcastSkipped ? '<p>⚠ Broadcasts were not renamed: the project sends broadcasts computed at runtime (renaming would break the logic).</p>' : ''}
        <button id="again">Download again</button>`);
            $('again').onclick = () => download(lastBlob, lastName);
        } catch (e) {
            show('Error: ' + String(e.message || e).replace(/[<>&]/g, ''), true);
        }
    }

    $('chunk').addEventListener('change', e => { $('chunkLevel').disabled = !e.target.checked; });
    drop.addEventListener('click', () => input.click());
    drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') input.click(); });
    input.addEventListener('change', () => { handle(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', e => handle(e.dataTransfer.files[0]));
})();