#!/usr/bin/env node

// Tool to automate the taking and deleting of snapshots in Triton SDC.
//
// This tool is intended to be run as a cron job at the maximum frequency
// that a snapshot needs to be taken.  The job will interogate the cloudapi
// for instances with the following tags or mdata set:
//
// edu.msu.matrix:snapshotfrequency
//   This is a interval expressed as a string of the spacing that will be
//   the minimum delay between snapshots. Example '1d' one day '3h' hours
//   '1m' 1 minute.
//
// edu.msu.matrix:snapshotminimum
//   This is the minimum number of snapshots to retain.  Any more snapshots
//   than this number will be deleted.  Any given run of this tool will delete
//   at most one snapshot per instance.
//
// Setting either one of those will invoke the behavior referenced above.
// The behaviors can be used individually.
//
// Configuration for account information will be picked up from the environment.
// It is expected that triton env will have been run before this tool.

var bunyan = require('bunyan');
var path = require('path');
var triton = require('triton'); // typically `require('triton');`
var parseduration = require('parse-duration');

var log = bunyan.createLogger({
    name: path.basename(__filename),
    level: process.env.LOG_LEVEL || 'info',
    stream: process.stdout
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
            log.error( err );
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
                    log.info({instance: instance}, "Creating snapshot");
                    globalclient.cloudapi.createMachineSnapshot({
                        id: instance.id
                    }, function(err) {
                        if (err) {
                            log.error( err );
                            process.exitStatus = 1;
                        }
                    });
                }

            } else if (minage != null && age == null) {
                log.info({instance: instance}, "Creating snapshot");
                globalclient.cloudapi.createMachineSnapshot({
                    id: instance.id
                }, function(err) {
                    if (err) {
                        log.error( err );
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
            log.error( err );
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
                    log.info({instance: instance, snapshots: snapshots}, "deleting oldest snapshot");
                    globalclient.cloudapi.deleteMachineSnapshot({
                        id: instance.id,
                        name: snapshots.sort(sortsnapshots).shift().name
                    }, function(err) {
                        if (err) {
                            log.error( err );
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
        log.error( err );
        process.exitStatus = 1;
        return;
    }
    globalclient = client;
    // TODO: Eventually the top-level TritonApi will have `.listInstances()`.
    client.cloudapi.listMachines(function(err, insts) {

        if (err) {
            log.error( err );
            process.exitStatus = 1;
        } else {


            insts.forEach(maybecreatesnapshot);
            insts.forEach(maybedeletesnapshot);
        }
    });
});
