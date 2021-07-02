#!/usr/bin/env python3
import sys, json
from collections import defaultdict

# run like this:
#   tail -n 10000 -F chain.slog | python3 monitor-slog-block-time.py
# produces output like:
#
# -- block  swingset (avg2min)    %  --   block (avg2min)
#    1140      0.666    0.666   15%  --   4.360    4.360
#    1141      0.522    0.594   12%  --   4.921    4.641
#    1142      1.369    0.852   16%  --   5.923    5.068
#    1143      0.704    0.815   16%  --   4.387    4.898
#    1144      0.608    0.774   15%  --   4.970    4.912

blocks = defaultdict(dict)
recent_blocks = []

def abbrev(t):
    return "%1.3f" % t
def perc(n):
    return "%3d%%" % (n * 100)


head = "-- block  cranks(avg)   swingset(avg)     %  --  cosmos --  block(avg)      chainTime(avg)"
fmt  = "  %5d   %4s(%5s)  %6s(%6s)  %4s  --  %6s -- %6s(%6s)  %6s(%6s)"

class Summary:
    headline_counter = 0
    def summarize(self):
        if self.headline_counter == 0:
            print(head)
            self.headline_counter = 20
        self.headline_counter -= 1
        ( height, cranks,
          block_time, idle_time, cosmos_time, chain_block_time,
          swingset_time, swingset_percentage ) = recent_blocks[-1]
        cranks_s = "%3d" % cranks if cranks is not None else " "*4
        # 2 minutes is nominally 120/6= 20 blocks
        recent = recent_blocks[-20:]
        avg_cranks = sum(b[1] or 0 for b in recent) / len(recent)
        avg_cranks_s = "%3.1f" % avg_cranks
        avg_block_time = sum(b[2] for b in recent) / len(recent)
        avg_chain_block_time = sum(b[5] for b in recent) / len(recent)
        avg_swingset_time = sum(b[6] for b in recent) / len(recent)
        avg_swingset_percentage = sum(b[7] for b in recent) / len(recent)

        print(fmt % (height,
                     cranks_s, avg_cranks_s,
                     abbrev(swingset_time), abbrev(avg_swingset_time),
                     perc(avg_swingset_percentage),
                     abbrev(cosmos_time),
                     abbrev(block_time), abbrev(avg_block_time),
                     abbrev(chain_block_time), abbrev(avg_chain_block_time),
              ))

s = Summary()

last_crank = None

for line in sys.stdin:
    data = json.loads(line)
    if data["type"] == "deliver" and "crankNum" in data:
        last_crank = data["crankNum"]
    if data["type"] in ["cosmic-swingset-begin-block",
                        "cosmic-swingset-end-block-start",
                        "cosmic-swingset-end-block-finish"]:
        t = data["type"][len("cosmic-swingset-"):]
        height = data["blockHeight"]
        blocks[height][t] = data["time"]
        blocks[height]["blockTime"] = data["blockTime"]
        if len(blocks) < 2:
            continue
        if t == "end-block-finish":
            if last_crank:
                blocks[height]["last-crank"] = last_crank
            idle_time = None
            block_time = None
            cosmos_time = blocks[height]["end-block-start"] - blocks[height]["begin-block"]
            swingset_time = blocks[height]["end-block-finish"] - blocks[height]["end-block-start"]
            if blocks[height-1]:
                idle_time = blocks[height]["begin-block"] - blocks[height-1]["end-block-finish"]
                block_time = blocks[height]["end-block-finish"] - blocks[height-1]["end-block-finish"]
                swingset_percentage = swingset_time / block_time
                cranks = None
                if "last-crank" in blocks[height-1]:
                    cranks = blocks[height]["last-crank"] - blocks[height-1]["last-crank"]
                chain_block_time = blocks[height]["blockTime"] - blocks[height-1]["blockTime"]
            recent_blocks.append([ height, cranks,
                                   block_time, idle_time, cosmos_time, chain_block_time,
                                   swingset_time, swingset_percentage ])
            s.summarize()

