#/usr/bin/env bash

cd 
eval "$(triton env)"
/home/admin/automaticsnapshots.js >> snapshotengine.`/opt/local/bin/date +%Y-%m%d-%H`.log

