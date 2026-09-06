#!/usr/bin/env python3
"""Verify Kubernetes registry access before replacing the singleton controller."""

import copy
import json
import os
import re
import shlex
import subprocess
import sys
import uuid


def pull_check_job(deployment, container_name, image, name):
    source = deployment["spec"]["template"]["spec"]
    container = next(c for c in source["containers"] if c["name"] == container_name)
    # Match scheduling and registry credentials, but do not copy controller
    # labels, secrets, volumes, init containers, or the controller command.
    fields = (
        "serviceAccountName", "imagePullSecrets", "nodeSelector", "affinity",
        "tolerations", "runtimeClassName", "securityContext", "priorityClassName",
        "schedulerName", "nodeName",
    )
    pod = {key: copy.deepcopy(source[key]) for key in fields if key in source}
    pod.update({
        "restartPolicy": "Never",
        "automountServiceAccountToken": False,
        "enableServiceLinks": False,
        "containers": [{
            "name": "image-check",
            "image": image,
            # Always checks registry access even when the layers are cached.
            "imagePullPolicy": "Always",
            "command": ["node", "--eval", "process.exit(0)"],
            "resources": copy.deepcopy(container.get("resources", {})),
            "securityContext": copy.deepcopy(container.get("securityContext", {})),
        }],
    })
    return {
        "apiVersion": "batch/v1",
        "kind": "Job",
        "metadata": {"name": name},
        "spec": {
            "backoffLimit": 0,
            "activeDeadlineSeconds": 180,
            "ttlSecondsAfterFinished": 600,
            "template": {"spec": pod},
        },
    }


def deploy(run, deployment_name, container_name, image, job_name):
    if not re.fullmatch(r"ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[a-f0-9]{64}", image):
        raise ValueError("IMAGE_REF must be a GHCR image pinned to a sha256 digest")
    deployment = json.loads(run("get", "deployment", deployment_name, "-o", "json"))
    job = pull_check_job(deployment, container_name, image, job_name)
    try:
        run("create", "-f", "-", document=job)
        run("wait", "--for=condition=complete", "--timeout=240s", f"job/{job_name}")
    except Exception:
        print("Registry pull check failed; the controller Deployment was not changed. "
              "Check registry visibility, imagePullSecrets, and node connectivity.", file=sys.stderr)
        try:
            pods = json.loads(run("get", "pods", "-l", f"job-name={job_name}", "-o", "json"))
            for pod in pods["items"]:
                status = pod.get("status", {})
                print(json.dumps({
                    "pod": pod["metadata"]["name"], "phase": status.get("phase"),
                    "conditions": status.get("conditions", []),
                    "containers": [c.get("state", {}) for c in status.get("containerStatuses", [])],
                }), file=sys.stderr)
        except Exception as error:
            print(f"Could not read pull-check status: {error}", file=sys.stderr)
        raise
    finally:
        try:
            run("delete", "job", job_name, "--ignore-not-found", "--wait=false")
        except Exception as error:
            # The Job deadline and TTL also bound cleanup if the runner exits.
            print(f"Could not delete pull-check Job: {error}", file=sys.stderr)

    # Preserve deployment-specific settings, credentials, and the singleton
    # rollout strategy. Resource/priority changes are applied from the manifest.
    patch = {"spec": {"template": {"spec": {"containers": [{
        "name": container_name, "image": image, "imagePullPolicy": "IfNotPresent",
    }]}}}}
    run("patch", "deployment", deployment_name, "--type=strategic", "-p", json.dumps(patch))
    run("rollout", "status", f"deployment/{deployment_name}", "--timeout=300s")
    print(f"Deployed {image}")


def main():
    command = shlex.split(os.environ.get("KUBECTL_COMMAND", "kubectl"))
    if not command:
        raise ValueError("KUBECTL_COMMAND must not be empty")
    namespace = os.environ.get("NAMESPACE", "pulpo-workspaces")

    def run(*args, document=None):
        result = subprocess.run(
            [*command, "-n", namespace, *args],
            input=json.dumps(document) if document is not None else None,
            text=True, stdout=subprocess.PIPE, check=True, timeout=360,
        )
        return result.stdout

    deploy(
        run,
        os.environ.get("DEPLOYMENT_NAME", "pulpo-workspace-controller"),
        os.environ.get("CONTAINER_NAME", "controller"),
        os.environ.get("IMAGE_REF", ""),
        f"pulpo-controller-pull-check-{uuid.uuid4().hex[:12]}",
    )


if __name__ == "__main__":
    main()
