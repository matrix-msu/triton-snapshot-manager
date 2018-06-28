#!/usr/bin/env node

var bunyan = require('bunyan');
var path = require('path');
var triton = require('triton'); // typically `require('triton');`
var parseduration = require('parse-duration');

var log = bunyan.createLogger({
    name: path.basename(__filename),
    level: process.env.LOG_LEVEL || 'info',
    stream: process.stderr
});

function min(items) {
    if (items.length == 0) {
        return null;
    }
    var min = items.reduce(
        (accumulator, currentValue) => {
            return (accumulator < currentValue ? accumulator : currentValue);
        }
    );

    return min;
}

function max(items) {
    if (items.length == 0) {
        return null;
    }
    var min = items.reduce(
        (accumulator, currentValue) => {
            return (accumulator > currentValue ? accumulator : currentValue);
        }
    );

    return min;
}

function sortsnapshots(a,b) {
  if (a.name < b.name)
     return -1;
  if (a.name > b.name)
    return 1;
  return 0;
}

function maybecreatesnapshot(instance) {
    // For the provided instance, fire a snapshot if the frequency of time has passed.
    //
    globalclient.cloudapi.listMachineSnapshots(instance, function(err, snapshots) {
        if (err) {
            console.error('listMachineSnapshots error: %s\n%s', err, err.stack);
            process.exitStatus = 1;
        } else {

            ages = snapshots.map(function(snapshot) {
                return (Date.now() - Date.parse(snapshot.created));
            });

            age = min(ages);

            minage = null; // this is the minimum time between snapshots

            // The following logic makes tags override mdata.  The tag is right if the mdata disagrees.

            if (instance.metadata["edu.msu.matrix:snapshotfrequency"] != null && instance.tags["edu.msu.matrix:snapshotfrequency"] == null) {
                minage = parseduration(instance.metadata["edu.msu.matrix:snapshotfrequency"])
            };
            if (instance.tags["edu.msu.matrix:snapshotfrequency"] != null && instance.metadata["edu.msu.matrix:snapshotfrequency"] == null) {
                minage = parseduration(instance.tags["edu.msu.matrix:snapshotfrequency"])
            };
            if (instance.tags["edu.msu.matrix:snapshotfrequency"] != null && instance.metadata["edu.msu.matrix:snapshotfrequency"] != null) {
                minage = min([parseduration(instance.metadata["edu.msu.matrix:snapshotfrequency"]),
                    parseduration(instance.tags["edu.msu.matrix:snapshotfrequency"])
                ]);
            };

            if (minage != null && age != null) {
                if (age > minage) {
                    console.log("Creating snapshot for" + JSON.stringify(instance));
                    globalclient.cloudapi.createMachineSnapshot({
                        id: instance.id
                    }, function(err) {
                        if (err) {
                            console.error('createMachineSnapshot error: %s\n%s', err, err.stack);
                            process.exitStatus = 1;
                        }
                    });
                }

            } else if (minage != null && age == null) {
                console.log("Creating snapshot for" + JSON.stringify(instance));
                globalclient.cloudapi.createMachineSnapshot({
                    id: instance.id
                }, function(err) {
                    if (err) {
                        console.error('createMachineSnapshot error: %s\n%s', err, err.stack);
                        process.exitStatus = 1;
                    }
                });

            }
        }
    });
}

function maybedeletesnapshot(instance) {
    globalclient.cloudapi.listMachineSnapshots(instance, function(err, snapshots) {
        if (err) {
            console.error('listMachineSnapshots error: %s\n%s', err, err.stack);
            process.exitStatus = 1;
        } else {

            snaps = snapshots.length;

            minsnaps = null;

            // The following logic makes tags override mdata.  The tag is right if the mdata disagrees.
            //
            if (instance.metadata["edu.msu.matrix:snapshotminimum"] != null && instance.tags["edu.msu.matrix:snapshotminimum"] == null) {
                minsnaps = (instance.metadata["edu.msu.matrix:snapshotminimum"])
            };
            if (instance.tags["edu.msu.matrix:snapshotminimum"] != null && instance.metadata["edu.msu.matrix:snapshotminimum"] == null) {
                minsnaps = (instance.tags["edu.msu.matrix:snapshotminimum"])
            };
            if (instance.tags["edu.msu.matrix:snapshotminimum"] != null && instance.metadata["edu.msu.matrix:snapshotminimum"] != null) {
                minsnaps = max([
                	(instance.metadata["edu.msu.matrix:snapshotfrequency"]),
                    	(instance.tags["edu.msu.matrix:snapshotfrequency"])
                ]);
            };


            if (snaps != null && minsnaps != null) {
                if (snaps > minsnaps) {
                    console.log("deleting oldest snapshot for" + JSON.stringify(instance));
                    console.log("snapshots " + JSON.stringify(snapshots.sort(sortsnapshots)));
                    globalclient.cloudapi.deleteMachineSnapshot({
                        id: instance.id,
                        name: snapshots.sort(sortsnapshots).shift().name
                    }, function(err) {
                        if (err) {
                            console.error('deleteMachineSnapshot error: %s\n%s', err, err.stack);
                            process.exitStatus = 1;
                        }
                    });
                }

            }
        }
    });
}

var globalclient;

triton.createClient({
    log: log,
    // Use 'env' to pick up 'TRITON_/SDC_' env vars. Or manually specify a
    // `profile` object.
    profileName: 'env',
    unlockKeyFn: triton.promptPassphraseUnlockKey
}, function createdClient(err, client) {
    if (err) {
        console.error('error creating Triton client: %s\n%s', err, err.stack);
        process.exitStatus = 1;
        return;
    }
    globalclient = client;
    // TODO: Eventually the top-level TritonApi will have `.listInstances()`.
    client.cloudapi.listMachines(function(err, insts) {

        if (err) {
            console.error('listInstances error: %s\n%s', err, err.stack);
            process.exitStatus = 1;
        } else {


            insts.forEach(maybecreatesnapshot);
            insts.forEach(maybedeletesnapshot);
        }
    });
});
