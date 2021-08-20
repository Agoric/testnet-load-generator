#!/usr/bin/env python3
import sys, json
from collections import defaultdict

# run like this:
#   tail -n 10000 -F chain.slog | python3 monitor-slog-block-time.py
# produces output like:
#
# - block  blockTime   lag  -> cranks(avg)  swingset(avg)   +  cosmos = proc% (avg)
#   15538    6(6.2)   7.514 ->    0( 20.2)   0.000( 0.763)  +   0.002 =   0% ( 8.6)
#   15539    7(6.2)   6.523 ->   26( 17.1)   1.084( 0.665)  +   0.003 =  15% ( 7.7)
#   15540    6(6.2)   6.608 ->    0( 17.1)   0.000( 0.665)  +   0.002 =   0% ( 7.7)
#   15541    6(6.2)   6.631 ->    0( 17.1)   0.000( 0.665)  +   0.002 =   0% ( 7.7)

# All times are in seconds. For each block, the fields are:
#  chainTime: The consensus timestamp delta between this block and the previous
#             one (always an integer, since blockTime has low resolution), plus
#             a moving average
#  lag: Time elapsed from (consensus) blockTime to the BEGIN_BLOCK timestamp
#       in the slogfile. This includes the block proposer's timeout_commit delay,
#       network propagation to the monitoring node, and any local tendermint
#       verification.
#  cranks: The number of swingset cranks performed in the block, plus an average.
#  swingset: The amount of time spent in the kernel for this block, plus average.
#            This is from cosmic-swingset-end-block-start to -end-block-finish
#  cosmos: The amount of time spent in non-swingset block work, plus average.
#          This is from cosmic-swingset-begin-block to -end-block-start, and
#          includes all cosmos-sdk modules like Bank and Staking.
#  proc%: The percentage of time spent doing block processing, out of the total
#         time from one block to the next. 100% means the monitoring node has
#         no idle time between blocks, and is probably falling behind.

blocks = defaultdict(dict)
recent_blocks = []

def abbrev(t):
    return "%1.3f" % t
def abbrev1(t):
    return "%1.1f" % t
def perc(n):
    return "%3d%%" % (n * 100)


head = "- block  blockTime   lag  -> cranks(avg)  swingset(avg)   +  cosmos = proc% (avg)"
fmt  = "  %5d   %2d(%1.1f)  %6s -> %4s(%5s)  %6s(%6s)  +  %6s = %4s (%4s)"

class Summary:
    headline_counter = 0
    def summarize(self):
        if self.headline_counter == 0:
            print(head)
            self.headline_counter = 20
        self.headline_counter -= 1
        ( height, cranks,
          block_time, proc_frac, cosmos_time, chain_block_time,
          swingset_time, swingset_percentage,
          lag ) = recent_blocks[-1]
        cranks_s = "%3d" % cranks if cranks is not None else " "*4
        # 2 minutes is nominally 120/6= 20 blocks
        recent = recent_blocks[-20:]
        avg_cranks = sum(b[1] or 0 for b in recent) / len(recent)
        avg_cranks_s = "%3.1f" % avg_cranks
        avg_block_time = sum(b[2] for b in recent) / len(recent)
        avg_proc_frac = sum(b[3] for b in recent) / len(recent)
        avg_chain_block_time = sum(b[5] for b in recent) / len(recent)
        avg_swingset_time = sum(b[6] for b in recent) / len(recent)
        avg_swingset_percentage = sum(b[7] for b in recent) / len(recent)

        print(fmt % (height,
                     chain_block_time, avg_chain_block_time,
                     abbrev(lag),
                     cranks_s, avg_cranks_s,
                     abbrev(swingset_time), abbrev(avg_swingset_time),
                     abbrev(cosmos_time),
                     perc(proc_frac), abbrev1(100.0 * avg_proc_frac),
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
            lag = blocks[height]["begin-block"] - blocks[height]["blockTime"]
            if blocks[height-1]:
                idle_time = blocks[height]["begin-block"] - blocks[height-1]["end-block-finish"]
                block_time = blocks[height]["end-block-finish"] - blocks[height-1]["end-block-finish"]
                proc_time = blocks[height]["end-block-finish"] - blocks[height]["begin-block"]
                proc_frac = 1.0 * proc_time / block_time
                swingset_percentage = swingset_time / block_time
                cranks = None
                if "last-crank" in blocks[height-1]:
                    cranks = blocks[height]["last-crank"] - blocks[height-1]["last-crank"]
                chain_block_time = blocks[height]["blockTime"] - blocks[height-1]["blockTime"]
            recent_blocks.append([ height, cranks,
                                   block_time, proc_frac, cosmos_time, chain_block_time,
                                   swingset_time, swingset_percentage,
                                   lag])
            s.summarize()

