"""Last Commit Standing: whole matches of the simulation, played by a bot in jsc."""
import json
import os
import subprocess
import unittest

from sidequest import paths

from .test_avatar import JSC

HARNESS = os.path.join(os.path.dirname(__file__), "arena_harness.js")
ART_HARNESS = os.path.join(os.path.dirname(__file__), "art_harness.js")
DLC = os.path.join(paths.PROJECT_DIR, "dlc", "last-commit-standing")


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class ArenaTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        run = subprocess.run([JSC, HARNESS, "--", paths.PROJECT_DIR],
                             capture_output=True, text=True, timeout=120)
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)
        with open(os.path.join(DLC, "balance.json"), encoding="utf-8") as f:
            cls.balance = json.load(f)

    def matches(self):
        found = {k: v for k, v in self.result.items() if isinstance(v, dict) and "over" in v}
        found.update({"map " + k: v for k, v in self.result["maps"].items()})
        return found

    def test_met_things_are_tracked_for_hints(self):
        met = set(self.result["classic"]["alone"]["met"])
        self.assertIn("grunt", met)
        self.assertIn("gem", met)

    def test_every_text_has_english(self):
        entries = [e for section in ("upgrades", "gear", "achievements", "weapons", "modifiers")
                   for e in self.balance[section]]
        entries += [w["evolution"] for w in self.balance["weapons"]]
        for entry in entries:
            self.assertTrue(entry.get("name_en") and entry.get("text_en"), entry["id"])
            self.assertNotRegex(entry["name_en"] + entry["text_en"], "[А-Яа-яЁё]")
        for w in self.balance["weapons"]:
            self.assertNotRegex(w["count_name"][1], "[А-Яа-яЁё]")

    # --- solo modes (0.5) ---

    def test_daily_task(self):
        d = self.result["solo"]["daily"]
        self.assertTrue(d["same"])
        self.assertTrue(d["repeat"])  # same day, same input: the same match
        self.assertEqual(len(d["task"]["modifiers"]), self.balance["daily"]["modifiers"])
        self.assertEqual(len(set(d["task"]["modifiers"])), len(d["task"]["modifiers"]))
        self.assertGreaterEqual(d["maps"], 3)
        self.assertGreaterEqual(d["sets"], 8)
        self.assertEqual(d["allies"], 0)  # live agents stay out
        self.assertTrue(d["solo"])
        self.assertEqual((d["results"]["mode"], d["results"]["day"], d["results"]["with_agent"]),
                         ("daily", "2026-10-09", False))

    def test_session_ghost(self):
        g = self.result["solo"]["ghost"]
        self.assertEqual(g["allies"], 1)  # the ghost only, live agents ignored
        self.assertEqual((g["project"], g["session"]), ("demo", "ghost"))
        res = g["results"]
        self.assertEqual((res["reason"], res["mode"], res["ghost"]), ("done", "ghost", "abc"))
        # Two tasks 15 minutes apart: squeezed, and the match goes on after the first one.
        self.assertGreater(res["time"], 60)
        self.assertLess(res["time"], 120)
        self.assertEqual(g["unfinished"], "done")
        self.assertEqual(g["empty"], "done")

    def test_modifiers(self):
        m = self.result["solo"]["modifiers"]
        self.assertEqual(m["glass"]["modifiers"], ["glass_cannon", "no_medkits"])  # unknown dropped
        self.assertEqual((m["glass"]["max_hp"], m["glass"]["hp"], m["glass"]["damage"]), (50, 50, 2))
        self.assertGreater(m["glass"]["items"], 0)
        self.assertEqual(m["glass"]["medkits"], 0)
        self.assertTrue(m["rage"])
        self.assertEqual(m["pistol"], ["pistol"])
        self.assertAlmostEqual(m["code_review"], 1.5)
        sc = m["score"]
        self.assertEqual(sc["mul"], 1.95)
        self.assertGreater(sc["raw"], 0)
        self.assertTrue(sc["raw"] * 1.95 - 1 <= sc["score"] < (sc["raw"] + 1) * 1.95)
        self.assertEqual((sc["count"], sc["ids"]), (2, ["code_review", "glass_cannon"]))
        for mod in self.balance["modifiers"]:
            self.assertTrue(mod["name_en"] and mod["text_en"] and mod["score"] > 1, mod["id"])

    def test_solo_records(self):
        p = self.result["solo"]["progress"]
        self.assertEqual(p["days"], {"2026-10-07": 100, "2026-10-08": 50, "2026-10-09": 70})
        self.assertEqual((p["streak_today"], p["streak_tomorrow"], p["streak_gap"]), (3, 3, 0))
        self.assertEqual(p["ghosts"]["s1"], {"best_score": 300, "runs": 2, "at": 6})
        self.assertIn("ghost", p["ghost_done"])
        self.assertNotIn("done", p["ghost_done"])  # "with an agent" means a live one
        self.assertIn("daily", p["daily_week"])
        self.assertIn("daily_week", p["daily_week"])
        self.assertIn("hardcore", p["hardcore"])
        self.assertEqual(p["records"]["daily"]["matches"], 1)
        self.assertEqual(p["records"]["ghost"]["best_score"], 7)
        self.assertEqual(p["records"]["agent"]["matches"], 0)

    # --- the agent's real work (0.4) ---

    def test_commit_bomb_and_push_chest(self):
        a, AG = self.result["agent"], self.balance["agent"]
        self.assertEqual(a["commit"]["hit"], 20)
        self.assertEqual(a["commit"]["damage"], 20 * AG["commit"]["damage"])
        # Two pushes right away give one chest; after the cooldown, one more.
        self.assertEqual((a["push"]["first"], a["push"]["later"]), (1, 2))
        self.assertEqual((a["push"]["pushes"], a["push"]["commits"]), (3, 2))
        self.assertEqual((a["results"]["commits"], a["results"]["pushes"]), (2, 3))

    def test_build_turret(self):
        t, AG = self.result["agent"]["turret"], self.balance["agent"]
        self.assertEqual(t["placed"], AG["turret"]["max"])
        self.assertEqual(t["built"], AG["turret"]["max"] + 1)
        self.assertGreater(t["damage"], 0)
        self.assertEqual(t["after"], 0)

    def test_tests_shield_and_red_ci(self):
        t, AG = self.result["agent"]["tests"], self.balance["agent"]
        self.assertEqual(t["one"], AG["tests_passed"]["shield"])
        self.assertEqual(t["capped"], AG["tests_passed"]["max_shield"])
        self.assertEqual(t["red"], {"red": AG["red_ci"]["seconds"], "rage": 0})
        self.assertEqual(t["cleared"], 0)
        self.assertTrue(t["rage_on_other_errors"])
        self.assertGreater(t["spawned"][1], t["spawned"][0])

    def test_fast_reviewer(self):
        r, AG = self.result["agent"]["reviewer"], self.balance["agent"]
        self.assertTrue(r["waiting"])
        self.assertEqual(r["fast"], {"reviews": 1, "coffee": AG["reviewer"]["coffee_seconds"],
                                     "score": AG["reviewer"]["score"]})
        self.assertEqual(r["reviews"], 1)  # slow, the button, the agent itself: no bonus
        self.assertFalse(r["after"])

    def test_spirits_and_orchestra(self):
        sp, o = self.result["agent"]["spirits"], self.result["agent"]["orchestra"]
        self.assertEqual(sp["types"], {"Explore": "scout", "Plan": "plan",
                                       "general-purpose": "shooter", "none": "shooter"})
        self.assertGreater(sp["healed"], 0)
        self.assertGreater(sp["slowed"], 0)
        self.assertTrue(o["on"])
        self.assertFalse(o["off"])
        AG = self.balance["agent"]
        self.assertEqual(o["damage"], AG["commit"]["damage"] * AG["orchestra"]["ally_damage"])
        for id in ("commit", "orchestra", "spirit_scout", "spirit_plan", "spirit_shooter"):
            self.assertIn(id, self.result["agent"]["met"])

    # --- the arsenal ---

    def test_every_weapon_hurts_and_evolves_stronger(self):
        weapons = self.result["arsenal"]["weapons"]
        self.assertEqual(set(weapons), {w["id"] for w in self.balance["weapons"]})
        for name, w in weapons.items():
            with self.subTest(name):
                self.assertTrue(w["base"]["finite"] and w["evolved"]["finite"])
                self.assertGreater(w["base"]["hurt"], 0)
                self.assertGreater(w["evolved"]["hurt"], w["base"]["hurt"] * 2)

    def test_weapons_are_well_formed(self):
        passives = {u["id"] for u in self.balance["upgrades"]}
        used = [w["evolution"]["passive"] for w in self.balance["weapons"]]
        self.assertEqual(self.balance["weapons"][0]["id"], "pistol")
        self.assertEqual(len(used), len(set(used)))  # one passive per evolution
        for w in self.balance["weapons"]:
            with self.subTest(w["id"]):
                self.assertIn(w["evolution"]["passive"], passives)
                self.assertEqual(len(w["levels"]), 7)
                for change in w["levels"] + [w["evolution"]["changes"]]:
                    for key in change:
                        self.assertIn(key, set(w["base"]) | {"count", "area", "duration", "pierce"})
        # Evolutions never need a passive only an agent can bring.
        ally = {u["id"] for u in self.balance["upgrades"] if u.get("ally")}
        self.assertFalse(ally & set(used))

    def test_slots_are_limited(self):
        slots = self.result["arsenal"]["slots"]
        build = self.balance["build"]
        self.assertEqual(slots["most"], {"weapons": build["weapon_slots"],
                                         "passives": build["passive_slots"]})
        self.assertEqual(slots["last"], ["filler"])
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertLessEqual(len(match["weapons"]), build["weapon_slots"])
                self.assertLessEqual(len(match["passives"]), build["passive_slots"])

    def test_no_ally_passives_without_an_agent(self):
        ally = {"passive:" + u["id"] for u in self.balance["upgrades"] if u.get("ally")}
        offered = set(self.result["classic"]["alone"]["offered"])
        self.assertTrue(any(k.startswith("weapon:") for k in offered))
        self.assertFalse(ally & offered)

    def test_evolution(self):
        ev = self.result["arsenal"]["evolution"]
        self.assertNotIn("evolution", ev["before"])  # the passive is missing yet
        self.assertEqual(ev["offer"][0], "evolution:pistol")
        self.assertTrue(ev["evolved"])
        self.assertEqual(ev["reloads"], 0)  # while (true)
        self.assertFalse(ev["again"])
        self.assertEqual(ev["evolutions"], 1)

    def test_reroll_and_banish(self):
        r = self.result["arsenal"]["reroll"]
        build = self.balance["build"]
        self.assertEqual(r["rerolls"], list(range(build["rerolls"] - 1, -1, -1)))
        self.assertEqual(r["banishes"], list(range(build["banishes"] - 1, -1, -1)))
        self.assertEqual(len(r["banished"]), build["banishes"])
        self.assertFalse(r["back"])
        self.assertFalse(r["reroll_now"])

    def test_filler_when_everything_is_maxed(self):
        f = self.result["arsenal"]["filler"]
        self.assertEqual(f["kinds"], ["filler"])
        self.assertEqual(f["healed"], self.balance["build"]["filler"]["heal"])
        self.assertEqual(f["score"], self.balance["build"]["filler"]["score"])

    def test_level_text(self):
        self.assertEqual(self.result["arsenal"]["level_text"],
                         ["дробинки +2, задержка −15%", "pellets +2, cooldown −15%"])

    def test_no_broken_numbers(self):
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertIsNone(match["bad"])

    def test_match_ends_when_every_agent_is_done(self):
        for name in ("short-task", "long-task", "error-streak", "blocked",
                     "joined-mid-session", "unknown-tool", "busy_two"):
            with self.subTest(name):
                match = self.result[name]
                self.assertTrue(match["over"])
                self.assertEqual(match["results"]["reason"], "done")
                self.assertTrue(all(state == "gone" for state in match["allies"]))

    def test_one_agent_done_does_not_end_the_match(self):
        for name in ("two-agents", "busy_two_mid"):
            with self.subTest(name):
                match = self.result[name]
                self.assertFalse(match["over"])
                self.assertEqual(len(match["allies"]), 2)
                self.assertIn("active", match["allies"])

    def test_weapon_reloads_and_tracks_shots(self):
        self.assertGreater(self.result["busy_two"]["reloads"], 10)
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertEqual(match["leaked"], 0)

    def test_every_map_plays_to_the_end(self):
        self.assertGreaterEqual(len(self.result["maps"]), 4)
        for name, match in self.result["maps"].items():
            with self.subTest(name):
                self.assertTrue(match["over"])
                self.assertEqual(match["results"]["map"], name)

    def test_nothing_stands_inside_walls(self):
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertEqual(match["in_walls"], 0)

    def test_enemies_find_the_way_around_walls(self):
        path = self.result["pathfinding"]
        self.assertIsNotNone(path["reached"])
        self.assertLess(path["reached"], path["straight"] * 2)

    def test_no_agent_no_finale(self):
        idle = self.result["idle"]
        self.assertFalse(idle["over"])
        self.assertEqual(idle["level"], 1)
        self.assertGreater(idle["max_enemies"], 0)

    def test_agent_actions_level_up(self):
        self.assertGreaterEqual(self.result["busy_two"]["level"], 5)
        self.assertGreater(self.result["busy_two"]["choices"], 0)

    def test_enemy_count_is_capped(self):
        spawn = self.balance["spawn"]
        bosses = 1 + 30 // spawn["boss_every_minutes"]
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertLessEqual(match["max_enemies"], spawn["max_alive"] + bosses)

    def test_same_seed_same_match(self):
        self.assertTrue(self.result["repeatable"])

    def test_classic_crystals_level_up_without_an_agent(self):
        alone = self.result["classic"]["alone"]
        self.assertEqual(alone["allies"], [])
        self.assertGreaterEqual(alone["level"], 4)
        self.assertLessEqual(alone["gems"], self.balance["classic"]["max_gems"])

    def test_classic_ends_with_death(self):
        still = self.result["classic"]["still"]
        self.assertTrue(still["over"])
        self.assertEqual(still["results"]["reason"], "dead")
        self.assertEqual(still["results"]["mode"], "classic")
        self.assertFalse(still["results"]["with_agent"])

    def test_classic_agent_joins_and_does_not_end_the_run(self):
        run = self.result["classic"]["with_agent"]
        self.assertFalse(run["over"])
        self.assertTrue(run["with_agent"])
        self.assertIsNone(run["finale_at"])

    def test_classic_final_boss_wins_the_run(self):
        final = self.result["classic"]["final"]
        self.assertTrue(final["boss"])
        self.assertGreater(final["final_hp"], self.balance["enemies"]["boss"]["hp"] * 2)
        self.assertTrue(final["over"])
        self.assertEqual(final["results"]["reason"], "win")
        self.assertEqual(final["results"]["bosses"], 1)

    def test_chest_offers_each_piece_of_gear_once(self):
        gear = self.result["gear"]
        n = len(self.balance["gear"])
        for offer in gear["offers"][:n]:
            self.assertEqual(offer["kind"], "chest")
            self.assertTrue(offer["gear"])
            self.assertGreaterEqual(offer["n"], 1)
        self.assertEqual(gear["offers"][n]["kind"], None)  # nothing left: score instead
        self.assertEqual(gear["unique"], n)
        for g in self.balance["gear"]:
            with self.subTest(g["id"]):
                before, after = gear["before"][g["stat"]], gear["after"][g["stat"]]
                expected = before * g.get("mul", 1) + g.get("add", 0)
                self.assertAlmostEqual(after, expected)
        self.assertEqual(gear["shield"], 1)
        self.assertEqual(gear["level_first"], "level")
        self.assertIsNone(gear["choices_left"])
        self.assertEqual(gear["pending"], 0)

    def test_boss_leaves_a_chest(self):
        self.assertEqual(self.result["boss_chest"], {"dead": True, "chest": True, "medkit": True})

    def test_every_map_has_its_own_enemy(self):
        special = {"open": "race", "monorepo": "leak", "legacy": "deprecated", "hotfix": "nullptr"}
        for name, match in self.result["maps"].items():
            with self.subTest(name):
                self.assertIn(special[name], match["types"])
                others = set(special.values()) - {special[name]}
                self.assertFalse(others & set(match["types"]))

    def test_new_enemies(self):
        e = self.result["enemies"]
        self.assertEqual(e["leak"], {"dead": True, "small": 2})
        self.assertTrue(e["race"]["linked"])
        self.assertTrue(e["race"]["revived"])
        self.assertEqual(e["race"]["synced"], 1)
        self.assertEqual(e["race"]["left"], 0)
        self.assertAlmostEqual(e["nullptr"]["jumped"], e["nullptr"]["blink"], delta=2)
        self.assertEqual(e["nullptr"]["walls"], 0)
        self.assertTrue(e["deprecated"]["crossed"])
        self.assertLess(e["deprecated"]["reached"], e["deprecated"]["straight"] * 1.2)

    def test_bestiary_enemies(self):
        b, E = self.result["bestiary"], self.balance["enemies"]
        self.assertAlmostEqual(b["flaky"], 1 - E["flaky"]["miss"], delta=0.15)
        self.assertGreater(b["spaghetti"]["goo"], 3)
        self.assertAlmostEqual(b["spaghetti"]["slow"], E["spaghetti"]["trail"]["slow"], places=2)
        off = b["offbyone"]
        self.assertLessEqual(off["stopped"], E["offbyone"]["stop"])
        self.assertGreater(off["stopped"], E["offbyone"]["stop"] - 5)
        self.assertTrue(off["leapt"])
        self.assertLess(off["closest"], 3)
        self.assertGreater(b["debt"]["at5"], 1.4)
        self.assertAlmostEqual(b["debt"]["at65"], E["debt"]["max_growth"], places=1)
        self.assertAlmostEqual(b["debt"]["score"], E["debt"]["max_growth"], places=1)
        spam = b["logspam"]
        self.assertGreater(spam["shots"], 0)
        self.assertGreater(spam["hurt"], 0)
        self.assertGreater(spam["closest"], E["logspam"]["keep"] * 0.6)
        self.assertEqual(b["regression"], {"returned": True, "left": 0, "kills": 2})
        self.assertEqual(b["scope"], {"size": 3, "r": 3, "hp": 3})
        self.assertEqual(b["monolith"], E["monolith"]["release"]["count"])

    def test_elites(self):
        e = self.result["bestiary"]["elite"]
        self.assertEqual(e["tough"], self.balance["elites"]["hp"])
        self.assertFalse(e["hurtThroughShield"])
        self.assertTrue(e["dead"])
        self.assertTrue(e["chest"])
        self.assertEqual(e["elites"], 1)
        self.assertAlmostEqual(e["healed"], self.balance["elites"]["kinds"]["vampire"]["heal"], places=2)
        self.assertAlmostEqual(e["fast"], self.balance["elites"]["kinds"]["fast"]["speed"])
        self.assertIn("elite", self.result["busy_two"]["met"])

    def test_new_bosses(self):
        b, E = self.result["bestiary"], self.balance["enemies"]
        oom = E["boss_oom"]
        self.assertEqual(b["oom"], {"splits": 2, "smalls": 2 * oom["split"]["count"], "size": 2, "r": 2})
        loop = b["loop"]
        self.assertEqual(loop["segments"], E["boss_loop"]["segments"])
        self.assertLessEqual(loop["gap"], E["boss_loop"]["spacing"] + 0.01)
        self.assertAlmostEqual(loop["share"], E["boss_loop"]["segment_share"])
        self.assertTrue(loop["dead"] and loop["body_dead"])
        self.assertEqual((loop["bosses"], loop["kinds"]), (1, 1))
        race = b["race"]
        self.assertTrue(race["linked"] and race["revived"])
        self.assertAlmostEqual(race["half"], E["boss_race"]["revive_hp"], places=2)
        self.assertEqual(race["bosses_after_one"], 0)
        self.assertEqual((race["bosses"], race["synced"], race["left"]), (1, 1, 0))
        self.assertTrue(race["chest"])
        fire = b["fire"]
        self.assertGreater(fire["fires"], 0)
        self.assertEqual(fire["early"], 0)
        self.assertGreater(fire["hurt"], 0)

    def test_bosses_take_turns(self):
        order = self.result["bestiary"]["order"]
        bosses = self.balance["bosses"]
        self.assertEqual(sorted(order[:4]), sorted(bosses["order"]))
        self.assertEqual(order[4], bosses["then"])
        self.assertEqual(order[5], order[0])

    def test_arena_events(self):
        ev, E = self.result["bestiary"]["events"], self.balance["events"]
        self.assertEqual(ev["deploy"], {"started": True, "survived": 1, "over": True})
        self.assertGreaterEqual(ev["away"], E["incident"]["distance"][0] - 1)
        self.assertEqual(ev["closed"], 1)
        self.assertEqual(ev["chest"], 1)
        self.assertGreater(ev["rage"], 0)
        self.assertEqual(ev["incidents"], 1)
        self.assertFalse(ev["left"])
        self.assertGreater(ev["crowd"], 1.8)
        # A long match with an agent sees both on its own.
        self.assertIn("deploy", self.result["busy_two"]["met"])
        self.assertIn("incident", self.result["busy_two"]["met"])
        for key in ("elites", "incidents", "deploys", "boss_kinds"):
            self.assertIn(key, self.result["busy_two"]["results"])

    def test_old_records_carry_over(self):
        m = self.result["progress"]["migrated"]
        self.assertEqual(m["agent"]["best_score"], 900)
        self.assertEqual(m["agent"]["matches"], 3)
        self.assertEqual(m["classic"]["matches"], 0)
        self.assertEqual(m["totals"]["matches"], 3)
        self.assertEqual(m["totals"]["kills"], 400)
        junk = self.result["progress"]["junk"]
        self.assertEqual(junk["agent"]["best_score"], 0)
        self.assertEqual(junk["totals"]["maps"], {"legacy": 2})

    def test_records_are_kept_per_mode(self):
        r = self.result["progress"]["records"]
        won = self.result["classic"]["final"]["results"]
        self.assertEqual(r["agent"]["matches"], 3)
        self.assertEqual(r["classic"]["matches"], 1 + 4)
        self.assertEqual(r["classic"]["wins"], 1)
        self.assertEqual(r["classic"]["best_score"], won["score"])
        self.assertEqual(r["totals"]["matches"], 3 + 5)
        self.assertEqual(r["totals"]["bosses"], 1)
        self.assertEqual(sum(r["totals"]["maps"].values()), 5)

    def test_achievements(self):
        p = self.result["progress"]
        self.assertEqual(len(p["ids"]), len(set(p["ids"])))
        self.assertGreaterEqual(len(p["ids"]), 15)
        for a in self.balance["achievements"]:
            with self.subTest(a["id"]):
                self.assertTrue(a["name"] and a["text"] and a["when"])
                self.assertLessEqual(set(a["when"]), {"min", "max", "is", "total_min", "maps_all"})
        for a in ("first", "classic_win", "solo", "friday", "boss"):
            self.assertIn(a, p["after_win"])
        self.assertNotIn("tourist", p["after_win"])
        self.assertNotIn("done", p["after_win"])
        self.assertIn("tourist", p["tourist"])
        self.assertNotIn("classic_win", p["tourist"])
        self.assertIn("done", p["busy"])
        self.assertIn("pair", p["busy"])
        self.assertNotIn("solo", p["busy"])
        self.assertNotIn("reviewer", p["busy"])
        self.assertIn("reviewer", p["worked"])
        self.assertIn("atomic", p["worked"])

    def test_card_rows_fit_the_hub(self):
        card = self.result["progress"]["card"]
        self.assertLessEqual(len(card), 4)
        for label, value in card:
            self.assertEqual(set(label), {"ru", "en"})
            for text in label.values():
                self.assertLessEqual(len(text), 24)
            self.assertLessEqual(len(str(value)), 16)

    def test_step_is_fast(self):
        # A frame has ~16 ms; the simulation must leave nearly all of it to drawing.
        for name, match in self.matches().items():
            with self.subTest(name):
                self.assertLess(match["ms_per_step"], 2)


if __name__ == "__main__":
    unittest.main()


@unittest.skipUnless(os.path.exists(JSC), "JavaScriptCore jsc not found")
class ArenaArtTest(unittest.TestCase):
    """Sprites, the pixel font, and whole matches drawn into a fake canvas."""

    @classmethod
    def setUpClass(cls):
        run = subprocess.run([JSC, ART_HARNESS, "--", paths.PROJECT_DIR],
                             capture_output=True, text=True, timeout=120)
        if run.returncode:
            raise AssertionError(run.stdout + run.stderr)
        cls.result = json.loads(run.stdout)

    def test_handbook_covers_everything(self):
        self.assertEqual(self.result["codexErrors"], [])
        with open(os.path.join(DLC, "balance.json"), encoding="utf-8") as f:
            balance = json.load(f)
        ids = self.result["codexIds"]
        self.assertEqual(ids["gear"], [g["id"] for g in balance["gear"]])
        self.assertEqual(ids["passives"], [u["id"] for u in balance["upgrades"]])
        self.assertEqual(ids["weapons"], [w["id"] for w in balance["weapons"]]
                         + [w["evolution"]["id"] for w in balance["weapons"]])
        self.assertEqual(ids["work"], ["commit", "push", "turret", "tests", "red_ci", "reviewer",
                                       "orchestra"])
        self.assertIn("spirit_plan", ids["allies"])
        # Every enemy has a first-time hint, except the small leak (part of the big one).
        self.assertEqual(ids["events"], ["deploy", "incident"])
        for enemy in ("flaky", "monolith", "elite", "boss_oom", "boss_loop", "boss_race", "boss_fire"):
            self.assertIn(enemy, ids["enemies"])
        # Every enemy has a first-time hint, except the parts of others: the small leak, the
        # microservice and the loop's body.
        self.assertEqual(self.result["hints"], ["leak_small", "micro", "loop_segment"])

    def test_sprites_are_well_formed(self):
        self.assertEqual(self.result["spriteErrors"], [])

    def test_agent_work_is_drawn(self):
        for name in ("ask", "turret", "spirit", "spirit_scout", "spirit_plan", "red_ci", "orchestra",
                     "shield"):
            self.assertIn(name, self.result["drawn"])

    def test_bestiary_is_drawn(self):
        for name in ("flaky", "spaghetti", "offbyone", "debt", "logspam", "regression", "scope",
                     "monolith", "micro", "boss_oom", "boss_loop", "loop_segment", "boss_race",
                     "boss_fire", "goo", "fire", "log_line", "incident", "elite"):
            self.assertIn(name, self.result["drawn"])

    def test_sprite_sizes(self):
        sizes = self.result["sizes"]
        for name in ("grunt", "runner", "tank", "ally", "spirit"):
            with self.subTest(name):
                self.assertLessEqual(max(sizes[name]), 18)
        self.assertLessEqual(max(sizes["boss"]), 32)

    def test_font_covers_both_alphabets_and_game_texts(self):
        self.assertEqual(self.result["fontErrors"], [])
        self.assertEqual(self.result["missing"], [])
        self.assertGreater(len(self.result["texts"]), 5)
        self.assertEqual(self.result["missingInTexts"], [])

    def test_every_map_draws_a_whole_match(self):
        for name, match in self.result["maps"].items():
            with self.subTest(name):
                self.assertIsNone(match["error"])
                self.assertTrue(match["over"])
                self.assertTrue(match["sawItem"])
                self.assertGreater(match["picked"], 0)
                if name.startswith("classic"):
                    self.assertTrue(match["sawGem"])
                    self.assertEqual(match["reason"], "win")
        self.assertIsNone(self.result["badCall"])
