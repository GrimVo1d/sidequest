// The arena: the handbook. Everything the arena has, with a sprite and a text in
// both languages; numbers come from balance.json, so the texts never drift from the game.
// Weapons, passives and gear are read straight from balance.json. No DOM here: tests run it in jsc.
//   LCSCodex.sections(balance)   // [{id, name: [ru, en], entries: [{id, icon, gold, name, text}]}]
//   LCSCodex.entry(balance, id)  // an item, enemy, spirit, agent's work or arena event by id,
//                                // with kind: the first-time hint
"use strict";

(function (root) {
  const pct = (k) => Math.round(Math.abs(k - 1) * 100);

  function items(B) {
    const I = B.items, C = B.classic;
    return [
      {id: "medkit", icon: "medkit", name: ["Аптечка", "Medkit"],
       text: [`+${I.medkit.heal} к здоровью.`, `+${I.medkit.heal} health.`]},
      {id: "coffee", icon: "coffee", name: ["Кофе", "Coffee"],
       text: [`${I.coffee.seconds} сек ходишь на ${pct(I.coffee.speed)}% быстрее и стреляешь чаще.`,
              `For ${I.coffee.seconds} sec you move ${pct(I.coffee.speed)}% faster and shoot more often.`]},
      {id: "duck", icon: "duck", name: ["Резиновая уточка", "Rubber duck"],
       text: [`${I.duck.seconds} сек каждая пуля пробивает ещё ${I.duck.pierce} врагов.`,
              `For ${I.duck.seconds} sec every bullet goes through ${I.duck.pierce} more enemies.`]},
      {id: "shield", icon: "shield", name: ["Щит", "Shield"],
       text: [`Поглощает ${I.shield.hits} удара.`, `Takes ${I.shield.hits} hits for you.`]},
      {id: "chest", icon: "chest", name: ["Сундук", "Chest"],
       text: ["Остаётся после босса. Выбери одну вещь из трёх — она с тобой до конца матча. Когда всё снаряжение собрано — улучшения и редкие вещи.",
              "Left by a boss. Pick one of three items — it stays with you to the end of the match. Once all the gear is taken: upgrades and rare pieces."]},
      {id: "gem", icon: "gem", name: ["Кристалл", "Crystal"],
       text: [`«Классика»: опыт падает с врагов кристаллами, подбирай их. Рядом с игроком (${C.magnet} точек) они летят к нему сами.`,
              `Classic: experience drops from enemies as crystals; pick them up. Within ${C.magnet} points of you they fly to you.`]},
      {id: "rage", icon: "grunt", name: ["Ярость", "Rage"],
       text: [`Ошибка агента злит врагов: ${B.rage.seconds} сек они на ${pct(B.rage.speed)}% быстрее и больнее бьют.`,
              `An agent's error enrages the enemies: for ${B.rage.seconds} sec they are ${pct(B.rage.speed)}% faster and hit harder.`]},
    ];
  }

  function enemies(B) {
    const E = B.enemies;
    const from = (type) => E[type].from_minute
      ? [` Появляется после ${E[type].from_minute}:00.`, ` Appears after ${E[type].from_minute}:00.`]
      : ["", ""];
    const join = (pair, extra) => [pair[0] + extra[0], pair[1] + extra[1]];
    return [
      {id: "grunt", icon: "grunt", name: ["Баг", "Bug"],
       text: ["Обычный враг: идёт на тебя толпой.", "The usual enemy: comes at you in crowds."]},
      {id: "runner", icon: "runner", name: ["Опечатка", "Typo"],
       text: join(["Слабая, но быстрая.", "Weak but fast."], from("runner"))},
      {id: "tank", icon: "tank", name: ["Блокер", "Blocker"],
       text: join(["Медленный и очень прочный, бьёт больно.", "Slow and very tough, hits hard."],
                  from("tank"))},
      {id: "leak", icon: "leak", name: ["Утечка памяти", "Memory leak"],
       text: join([`Слизь: при смерти делится на ${E.leak.splits.count} маленьких. Только на Монорепо.`,
                   `A slime: splits into ${E.leak.splits.count} small ones when it dies. Monorepo only.`],
                  from("leak"))},
      {id: "race", icon: "race", name: ["Race condition", "Race condition"],
       text: join([`Ходят парой. Убей обоих за ${E.race.revive_seconds} сек, иначе второй поднимет первого; одновременно — +${E.race.sync_score} очков. Только на Open space.`,
                   `Come in pairs. Kill both within ${E.race.revive_seconds} sec or the other one brings its twin back; at once — +${E.race.sync_score} score. Open space only.`],
                  from("race"))},
      {id: "nullptr", icon: "nullptr", name: ["Null pointer", "Null pointer"],
       text: join([`Мигает и раз в ~${E.nullptr.blink_every} сек прыгает к тебе на ${E.nullptr.blink_distance} точек. Только на Хотфиксе.`,
                   `Glitches and every ~${E.nullptr.blink_every} sec jumps ${E.nullptr.blink_distance} points towards you. Hotfix only.`],
                  from("nullptr"))},
      {id: "deprecated", icon: "deprecated", name: ["Deprecated", "Deprecated"],
       text: join(["Призрак: проходит сквозь стены. Только на Легаси.",
                   "A ghost: walks through walls. Legacy only."], from("deprecated"))},
      {id: "flaky", icon: "flaky", name: ["Флаки-тест", "Flaky test"],
       text: join([`То проходит, то падает: ${Math.round(E.flaky.miss * 100)}% пуль летят мимо. Взрывам и лучам это не помогает.`,
                   `Passes, fails, passes: ${Math.round(E.flaky.miss * 100)}% of bullets go right past. Blasts and beams still hit.`],
                  from("flaky"))},
      {id: "spaghetti", icon: "spaghetti", name: ["Спагетти-код", "Spaghetti code"],
       text: join([`Оставляет за собой соус: в нём ты на ${Math.round((1 - E.spaghetti.trail.slow) * 100)}% медленнее.`,
                   `Leaves a trail of sauce: in it you are ${Math.round((1 - E.spaghetti.trail.slow) * 100)}% slower.`],
                  from("spaghetti"))},
      {id: "offbyone", icon: "offbyone", name: ["Off-by-one", "Off-by-one"],
       text: join(["Останавливается в шаге от тебя, приседает и прыгает туда, где ты был. Отойди.",
                   "Stops one step short of you, crouches and jumps where you were. Step aside."],
                  from("offbyone"))},
      {id: "debt", icon: "debt", name: ["Технический долг", "Technical debt"],
       text: join([`Пока жив, здоровье и очки за него копятся — до ${E.debt.max_growth} раз. Гаси сразу.`,
                   `While it lives, its health and its score pile up — up to ${E.debt.max_growth} times. Pay it off early.`],
                  from("debt"))},
      {id: "logspam", icon: "logspam", name: ["Спамер логов", "Log spammer"],
       text: join(["Держится на расстоянии и стреляет строками логов. От них надо уворачиваться, стены их останавливают.",
                   "Keeps its distance and fires lines of logs. Dodge them; walls stop them."],
                  from("logspam"))},
      {id: "regression", icon: "regression", name: ["Регрессия", "Regression"],
       text: join([`После смерти возвращается — один раз, через ${E.regression.return_seconds} сек, на том же месте.`,
                   `Comes back after it dies — once, ${E.regression.return_seconds} sec later, in the same place.`],
                  from("regression"))},
      {id: "scope", icon: "scope", name: ["Скоуп-крип", "Scope creep"],
       text: join([`Растёт: каждые ${E.scope.grow_every} сек становится больше и прочнее, до ${E.scope.max_size} раз.`,
                   `Grows: every ${E.scope.grow_every} sec it gets bigger and tougher, up to ${E.scope.max_size} times.`],
                  from("scope"))},
      {id: "monolith", icon: "monolith", name: ["Монолит", "Monolith"],
       text: join([`Огромный, медленный и прочный. Раз в ${E.monolith.release.every} сек выпускает ${E.monolith.release.count} микросервиса.`,
                   `Huge, slow and tough. Every ${E.monolith.release.every} sec it lets out ${E.monolith.release.count} microservices.`],
                  from("monolith"))},
      {id: "elite", icon: "elite", name: ["Элитный враг", "Elite enemy"],
       text: [`Золотой контур и корона: в ${B.elites.hp} раза прочнее и с одним свойством — быстрый, со щитом или вампир (лечится, когда бьёт тебя). С него падает сундук. Появляются после ${B.elites.from_minute}:00.`,
              `A golden outline and a crown: ${B.elites.hp} times tougher, with one trait — fast, shielded or a vampire (heals when it hits you). Drops a chest. Appear after ${B.elites.from_minute}:00.`]},
      {id: "boss", icon: "boss", name: ["Конфликт слияния", "Merge conflict"],
       text: [`Босс. Боссы приходят раз в ${B.spawn.boss_every_minutes} минут по очереди: четыре новых в случайном порядке, потом этот. С каждого — сундук и предметы.`,
              `A boss. Bosses come every ${B.spawn.boss_every_minutes} minutes in turn: the four new ones in a random order, then this one. Each leaves a chest and items.`]},
      {id: "boss_oom", icon: "boss_oom", name: [E.boss_oom.name, E.boss_oom.name_en],
       text: [`Босс: растёт со временем, а теряя каждые ${Math.round(E.boss_oom.split_every * 100)}% здоровья, отпускает ${E.boss_oom.split.count} маленькие утечки.`,
              `A boss: grows with time, and every ${Math.round(E.boss_oom.split_every * 100)}% of health it loses lets out ${E.boss_oom.split.count} small leaks.`]},
      {id: "boss_loop", icon: "boss_loop", name: [E.boss_loop.name, E.boss_loop.name_en],
       text: [`Босс: змея кружит вокруг тебя, кольцо то сжимается, то расходится. Тело принимает лишь ${Math.round(E.boss_loop.segment_share * 100)}% урона — бей в голову.`,
              `A boss: a snake circling round you, its ring closing in and opening up. The body takes only ${Math.round(E.boss_loop.segment_share * 100)}% of the damage — hit the head.`]},
      {id: "boss_race", icon: "boss_race", name: [E.boss_race.name, E.boss_race.name_en],
       text: [`Боссы-близнецы. Убей обоих за ${E.boss_race.revive_seconds} сек, иначе второй поднимет первого с половиной здоровья. Одновременно — +${E.boss_race.sync_score} очков.`,
              `Twin bosses. Kill both within ${E.boss_race.revive_seconds} sec or the other one brings its twin back at half health. At once — +${E.boss_race.sync_score} score.`]},
      {id: "boss_fire", icon: "boss_fire", name: [E.boss_fire.name, E.boss_fire.name_en],
       text: [`Босс: поджигает пол у тебя под ногами — место сначала мигает — и оставляет огонь за собой. Не стой в огне.`,
              `A boss: sets the floor under you on fire — the spot blinks first — and leaves fire behind it. Don't stand in it.`]},
      {id: "final", icon: "boss", name: ["Финальный конфликт", "Final conflict"],
       text: [`Финальный босс «Классики» на ${B.classic.seconds / 60}-й минуте, в ${B.classic.final_hp} раза прочнее. Победи его — и забег выигран.`,
              `The final boss of Classic at minute ${B.classic.seconds / 60}, ${B.classic.final_hp} times tougher. Beat it and the run is won.`]},
    ];
  }

  // The player, the agents and what their actions turn into.
  function allies(B) {
    const A = B.abilities;
    return [
      {id: "player", icon: "gun", name: ["Ты", "You"],
       text: [`Оружие стреляет само, ты ходишь и уворачиваешься. До ${B.build.weapon_slots} оружий и ${B.build.passive_slots} пассивок; на новом уровне — выбор из трёх, их можно перебросить (${B.build.rerolls} раза за матч) или исключить (${B.build.banishes}).`,
              `Weapons fire by themselves; you move and dodge. Up to ${B.build.weapon_slots} weapons and ${B.build.passive_slots} passives; each level-up offers three cards, which you can reroll (${B.build.rerolls} times a match) or banish (${B.build.banishes}).`]},
      {id: "ally", icon: "ally", name: ["Агент", "Agent"],
       text: [`Союзник — сессия Claude Code. Его действия становятся атаками и дают тебе опыт; каждые ${B.items.ally_every_actions} действий он приносит предмет.`,
              `An ally is a Claude Code session. Its actions turn into attacks and give you experience; every ${B.items.ally_every_actions} actions it brings an item.`]},
      {id: "attack", icon: "missile", name: ["Правка", "Edit"],
       text: [`Edit / Write: ракета в ближайшего врага, ${A.attack.damage}+ урона, больше за каждую строку.`,
              `Edit / Write: a missile at the nearest enemy, ${A.attack.damage}+ damage, more for every line.`]},
      {id: "scout", icon: "ally", name: ["Чтение", "Read"],
       text: [`Read / Grep / Glob: враги вокруг агента замедлены на ${Math.round((1 - A.scout.slow) * 100)}% на ${A.scout.seconds} сек.`,
              `Read / Grep / Glob: enemies around the agent are ${Math.round((1 - A.scout.slow) * 100)}% slower for ${A.scout.seconds} sec.`]},
      {id: "cast", icon: "spark", name: ["Команда", "Command"],
       text: [`Bash: взрыв, ${A.cast.damage} урона; тесты — большой взрыв, ${A.cast_test.damage} урона.`,
              `Bash: a blast, ${A.cast.damage} damage; tests — a big blast, ${A.cast_test.damage} damage.`]},
      {id: "scout_far", icon: "bullet", name: ["Веб", "Web"],
       text: [`WebSearch / WebFetch: луч через всю арену, ${A.scout_far.damage} урона.`,
              `WebSearch / WebFetch: a beam across the arena, ${A.scout_far.damage} damage.`]},
    ].concat(spirits(B), [
      {id: "states", icon: "ally", name: ["Состояния агента", "Agent states"],
       text: [`Ошибка — оглушён на ${B.ally.stun_seconds} сек, враги в ярости. Запрет — бьётся о щит «ЗАПРЕТ». Compaction — медитирует: неуязвим, не атакует. Ждёт ответа — «?» над головой, игра на паузе. Задача готова — ульта, экран зачищен.`,
              `Error — stunned for ${B.ally.stun_seconds} sec, enemies enraged. Blocked — hits a BLOCKED shield. Compaction — meditates: invulnerable, no attacks. Waiting for an answer — a “?” over the head, the game pauses. Task done — the ultimate clears the screen.`]},
    ]);
  }

  // Subagents: a spirit for each, its kind by the subagent's type.
  function spirits(B) {
    const SP = B.agent.spirits;
    return [
      {id: "spirit_shooter", icon: "spirit", name: ["Дух", "Spirit"],
       text: ["Сабагент: дух кружит рядом и стреляет во врагов, пока сабагент работает.",
              "A subagent: a spirit circles around and shoots enemies while the subagent works."]},
      {id: "spirit_scout", icon: "spirit_scout", name: ["Дух-разведчик", "Scout spirit"],
       text: [`Сабагент Explore: раз в ${SP.scout.every} сек замедляет врагов вокруг себя на ${Math.round((1 - SP.scout.slow) * 100)}%.`,
              `An Explore subagent: every ${SP.scout.every} sec it slows the enemies around it by ${Math.round((1 - SP.scout.slow) * 100)}%.`]},
      {id: "spirit_plan", icon: "spirit_plan", name: ["Дух-планировщик", "Planner spirit"],
       text: [`Сабагент Plan: раз в ${SP.plan.every} сек лечит тебя на ${SP.plan.heal}.`,
              `A Plan subagent: every ${SP.plan.every} sec it heals you by ${SP.plan.heal}.`]},
    ];
  }

  // What the agent's real work turns into: git, builds, tests, your answers, many agents.
  function work(B) {
    const AG = B.agent;
    return [
      {id: "commit", icon: "commit", name: ["Коммит-бомба", "Commit bomb"],
       text: [`Агент сделал git commit: золотой взрыв вокруг него, ${AG.commit.damage} урона.`,
              `The agent ran git commit: a golden blast around it, ${AG.commit.damage} damage.`]},
      {id: "push", icon: "chest", name: ["Пуш", "Push"],
       text: [`git push или gh pr create: агент оставляет сундук со снаряжением. Не чаще раза в ${Math.round(AG.push.cooldown_seconds / 60 * 10) / 10} мин.`,
              `git push or gh pr create: the agent leaves a chest of gear. At most once in ${Math.round(AG.push.cooldown_seconds / 60 * 10) / 10} min.`]},
      {id: "turret", icon: "turret", name: ["Турель", "Turret"],
       text: [`Сборка (make, npm run build…): агент ставит турель на ${AG.turret.seconds} сек, она стреляет в ближайших врагов. Не больше ${AG.turret.max}.`,
              `A build (make, npm run build…): the agent sets up a turret for ${AG.turret.seconds} sec that shoots the nearest enemies. At most ${AG.turret.max}.`]},
      {id: "tests", icon: "tests_ok", name: ["Тесты прошли", "Tests passed"],
       text: [`+${AG.tests_passed.shield} к щиту (до ${AG.tests_passed.max_shield}) и «красный CI» гаснет.`,
              `+${AG.tests_passed.shield} shield (up to ${AG.tests_passed.max_shield}), and a red CI goes out.`]},
      {id: "red_ci", icon: "red_ci", name: ["Красный CI", "Red CI"],
       text: [`Тесты упали: ${AG.red_ci.seconds} сек враги на ${Math.round((AG.red_ci.speed - 1) * 100)}% быстрее, а приходят в ${AG.red_ci.spawn} раза чаще. Вместо ярости.`,
              `Tests failed: for ${AG.red_ci.seconds} sec enemies are ${Math.round((AG.red_ci.speed - 1) * 100)}% faster and come ${AG.red_ci.spawn} times as often. Instead of rage.`]},
      {id: "reviewer", icon: "ask", name: ["Быстрый ревьюер", "Fast reviewer"],
       text: [`Агент ждёт ответа — над ним «?». Ответишь за ${AG.reviewer.answer_seconds} сек — кофе на ${AG.reviewer.coffee_seconds} сек и +${AG.reviewer.score} очков.`,
              `The agent waits for an answer — a “?” over it. Answer within ${AG.reviewer.answer_seconds} sec for ${AG.reviewer.coffee_seconds} sec of coffee and +${AG.reviewer.score} score.`]},
      {id: "orchestra", icon: "orchestra", name: ["Оркестр", "Orchestra"],
       text: [`${AG.orchestra.agents} агента и больше одновременно, сабагенты тоже считаются: союзники бьют на ${Math.round((AG.orchestra.ally_damage - 1) * 100)}% сильнее, опыта на ${Math.round((AG.orchestra.xp - 1) * 100)}% больше.`,
              `${AG.orchestra.agents} or more agents at once, subagents count too: allies hit ${Math.round((AG.orchestra.ally_damage - 1) * 100)}% harder and give ${Math.round((AG.orchestra.xp - 1) * 100)}% more experience.`]},
    ];
  }

  // Things that happen to the whole arena now and then.
  function events(B) {
    const EV = B.events, D = EV.deploy, Z = EV.incident;
    const every = EV.every.map((x) => Math.round(x / 60 * 10) / 10);
    const ru = (x) => String(x).replace(".", ",");
    return [
      {id: "deploy", icon: "deploy", name: ["Пятничный деплой", "Friday deploy"],
       text: [`${D.seconds} сек враги идут в ${D.spawn} раза гуще. Продержись — +${D.score} очков. События на арене — раз в ${ru(every[0])}–${ru(every[1])} мин.`,
              `For ${D.seconds} sec enemies come ${D.spawn} times as thick. Hold out for +${D.score} score. Arena events come every ${every[0]}–${every[1]} min.`]},
      {id: "incident", icon: "incident", name: ["Инцидент", "Incident"],
       text: [`На карте загорается зона. Простой в ней ${Z.hold} сек за ${Z.seconds} сек — сундук и +${Z.score} очков; не успеешь — враги в ярости ${Z.fail_rage} сек.`,
              `A zone lights up on the map. Stand in it for ${Z.hold} sec within ${Z.seconds} sec for a chest and +${Z.score} score; miss it and the enemies rage for ${Z.fail_rage} sec.`]},
    ];
  }

  // What some maps have on them (maps.js, terrain.js).
  function terrain(B) {
    const K = B.terrain, ru = (x) => String(x).replace(".", ",");
    return [
      {id: "door", icon: "door", name: ["Дверь", "Door"],
       text: [`«Легаси», «Микросервисы»: открыта ${K.door.open} сек, закрыта ${K.door.closed}. За ${ru(K.door.warn)} сек до того, как закрыться, мигает.`,
              `Legacy, Microservices: open for ${K.door.open} sec, shut for ${K.door.closed}. It blinks ${K.door.warn} sec before it shuts.`]},
      {id: "crack", icon: "crack", name: ["Треснувшая стена", "Cracked wall"],
       text: [`«Легаси»: ${K.crack.hp} урона пулями или взрывами — и стены нет до конца матча.`,
              `Legacy: ${K.crack.hp} damage from bullets or blasts and the wall is gone for the match.`]},
      {id: "rack", icon: "rack", name: ["Серверная стойка", "Server rack"],
       text: [`«Монорепо», «Прод»: после ${K.rack.hp} урона взрывается: ${K.rack.damage} урона врагам рядом и ${K.rack.player_damage} тебе, если стоишь близко. Через ${K.rack.back} сек её ставят снова.`,
              `Monorepo, Production: after ${K.rack.hp} damage it blows up: ${K.rack.damage} damage to the enemies near and ${K.rack.player_damage} to you if you stand close. It is back in ${K.rack.back} sec.`]},
      {id: "belt", icon: "belt", name: ["Конвейер", "Conveyor belt"],
       text: [`«CI/CD»: везёт всех, кто на нём стоит, — тебя, союзников, врагов и кристаллы — со скоростью ${K.belt.speed}.`,
              `CI/CD: carries everyone on it, you, the allies, the enemies and the crystals, at speed ${K.belt.speed}.`]},
      {id: "pit", icon: "pit", name: ["Дыра в облаке", "Hole in the cloud"],
       text: ["«Облако»: враг, упавший в дыру, погибает. Взрывы отбрасывают врагов — толкай их туда. Ты в дыру не упадёшь, но и не пройдёшь.",
              "Cloud: an enemy that falls in a hole dies. Blasts throw enemies back, so push them in. You can't fall in, but you can't cross either."]},
      {id: "pad", icon: "pad", name: ["Телепорт", "Teleport"],
       text: [`«Микросервисы»: встань на круг — и ты на круге того же цвета. Снова — через ${K.pad.cooldown} сек.`,
              `Microservices: step on a disc to land on the disc of the same color. Again in ${K.pad.cooldown} sec.`]},
      {id: "vent", icon: "vent", name: ["Огненная решётка", "Fire vent"],
       text: [`«Прод»: решётки горят по очереди, каждые ${K.vent.every} сек; перед огнём мигают ${ru(K.vent.warn)} сек. Огонь ${ru(K.vent.burn)} сек жжёт и тебя, и врагов.`,
              `Production: the vents burn in turn every ${K.vent.every} sec and blink ${K.vent.warn} sec before. The fire burns you and the enemies for ${K.vent.burn} sec.`]},
      {id: "dark", icon: "dark", name: ["Темнота", "Darkness"],
       text: ["«Ночной офис»: видно только вокруг тебя, союзников и взрывов.",
              "Night office: you see only around you, the allies and the blasts."]},
    ];
  }

  // Gear: what it does, its levels, and whether only a full set of the usual pieces opens it.
  function gear(B) {
    const n = B.chest.max_level;
    return B.gear.map((g) => ({
      id: g.id, icon: g.id, gold: Boolean(g.rare), name: [g.name, g.name_en],
      text: [`${g.text[0].toUpperCase()}${g.text.slice(1)}. Уровни 2–${n}: ${g.up.text}.`
             + (g.rare ? " Редкое: только из сундука, когда всё обычное снаряжение собрано." : ""),
             `${g.text_en[0].toUpperCase()}${g.text_en.slice(1)}. Levels 2–${n}: ${g.up.text_en}.`
             + (g.rare ? " Rare: only from a chest once every usual piece is taken." : "")],
    }));
  }

  function fromBalance(list) {
    return list.map((x) => ({id: x.id, icon: x.id, name: [x.name, x.name_en],
                             text: [x.text, x.text_en]}));
  }

  // Every weapon, then every evolution with what it takes.
  function weapons(B) {
    const passive = (id) => B.upgrades.find((u) => u.id === id);
    const list = B.weapons.map((w) => ({
      id: w.id, icon: w.id, name: [w.name, w.name_en],
      text: [`${w.text} Уровней: ${w.levels.length + 1}.`, `${w.text_en} Levels: ${w.levels.length + 1}.`],
    }));
    for (const w of B.weapons) {
      const ev = w.evolution, p = passive(ev.passive);
      list.push({
        id: ev.id, icon: w.id, gold: true, name: [ev.name, ev.name_en],
        text: [`Эволюция: «${w.name}» на ${w.levels.length + 1}-м уровне и «${p.name}». ${ev.text[0].toUpperCase()}${ev.text.slice(1)}.`,
               `Evolution: ${w.name_en} at level ${w.levels.length + 1} and ${p.name_en}. ${ev.text_en[0].toUpperCase()}${ev.text_en.slice(1)}.`],
      });
    }
    return list;
  }

  function sections(B) {
    return [
      {id: "items", name: ["Предметы", "Items"], entries: items(B)},
      {id: "weapons", name: ["Оружие", "Weapons"], entries: weapons(B)},
      {id: "passives", name: ["Пассивки", "Passives"], entries: fromBalance(B.upgrades)},
      {id: "gear", name: ["Снаряжение", "Gear"], entries: gear(B)},
      {id: "enemies", name: ["Враги", "Enemies"], entries: enemies(B)},
      {id: "allies", name: ["Ты и союзники", "You and allies"], entries: allies(B)},
      {id: "work", name: ["Работа агента", "Agent's work"], entries: work(B)},
      {id: "events", name: ["События", "Events"], entries: events(B)},
      {id: "map", name: ["Карта", "Map"], entries: terrain(B)},
    ];
  }

  // Things that get a hint the first time the player meets them; kind "item", "enemy",
  // "ally" (spirits and the agent's work), "event" or "map".
  function entry(B, id) {
    const found = items(B).map((e) => Object.assign({kind: "item"}, e))
      .concat(enemies(B).map((e) => Object.assign({kind: "enemy"}, e)))
      .concat(spirits(B).concat(work(B)).map((e) => Object.assign({kind: "ally"}, e)))
      .concat(events(B).map((e) => Object.assign({kind: "event"}, e)))
      .concat(terrain(B).map((e) => Object.assign({kind: "map"}, e)))
      .find((e) => e.id === id);
    return found || null;
  }

  root.LCSCodex = {sections, entry};
})(typeof window !== "undefined" ? window : globalThis);
