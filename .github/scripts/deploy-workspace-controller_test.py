import copy
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "deploy_controller", Path(__file__).with_name("deploy-workspace-controller.py"),
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

IMAGE = "ghcr.io/example/pulpo-workspace-controller@sha256:" + "a" * 64
DEPLOYMENT = {
    "spec": {"template": {
        "metadata": {"labels": {"app.kubernetes.io/name": "pulpo-workspace-controller"}},
        "spec": {
            "serviceAccountName": "controller",
            "imagePullSecrets": [{"name": "registry"}],
            "nodeSelector": {"pool": "control"},
            "tolerations": [{"key": "control", "operator": "Exists"}],
            "priorityClassName": "pulpo-workspace-controller",
            "volumes": [{"name": "credentials", "secret": {"secretName": "auth"}}],
            "initContainers": [{"name": "init", "image": "example/init"}],
            "containers": [{
                "name": "controller", "image": "old-local-image:main",
                "env": [{"name": "TOKEN", "value": "must-not-be-copied"}],
                "resources": {"requests": {"ephemeral-storage": "256Mi"}},
                "securityContext": {"runAsNonRoot": True, "runAsUser": 1000},
                "readinessProbe": {"httpGet": {"path": "/healthz", "port": 8786}},
            }],
        },
    }},
}


class FakeKubectl:
    def __init__(self, fail=None):
        self.calls = []
        self.fail = fail

    def __call__(self, *args, document=None):
        self.calls.append((args, document))
        if args[0] == self.fail:
            raise RuntimeError(f"{self.fail} failed")
        if args[:2] == ("get", "deployment"):
            return json.dumps(DEPLOYMENT)
        if args[:2] == ("get", "pods"):
            return json.dumps({"items": []})
        return ""


class DeploymentTest(unittest.TestCase):
    def test_probe_uses_registry_and_scheduling_without_controller_identity(self):
        original = copy.deepcopy(DEPLOYMENT)
        job = module.pull_check_job(DEPLOYMENT, "controller", IMAGE, "check")
        pod = job["spec"]["template"]["spec"]
        self.assertEqual(pod["imagePullSecrets"], [{"name": "registry"}])
        self.assertEqual(pod["serviceAccountName"], "controller")
        self.assertEqual(pod["nodeSelector"], {"pool": "control"})
        self.assertEqual(pod["priorityClassName"], "pulpo-workspace-controller")
        self.assertFalse(pod["automountServiceAccountToken"])
        self.assertNotIn("metadata", job["spec"]["template"])
        self.assertNotIn("volumes", pod)
        self.assertNotIn("initContainers", pod)
        container = pod["containers"][0]
        self.assertEqual(container["imagePullPolicy"], "Always")
        self.assertEqual(container["image"], IMAGE)
        self.assertEqual(container["command"], ["node", "--eval", "process.exit(0)"])
        self.assertNotIn("env", container)
        self.assertNotIn("readinessProbe", container)
        self.assertEqual(DEPLOYMENT, original)

    def test_successful_probe_precedes_deployment_change(self):
        run = FakeKubectl()
        module.deploy(run, "controller", "controller", IMAGE, "check")
        verbs = [args[0] for args, _ in run.calls]
        self.assertEqual(verbs, ["get", "create", "wait", "delete", "patch", "rollout"])
        patch = json.loads(run.calls[-2][0][-1])
        self.assertEqual(patch, {"spec": {"template": {"spec": {"containers": [{
            "name": "controller", "image": IMAGE, "imagePullPolicy": "IfNotPresent",
        }]}}}})

    def test_failed_pull_or_unschedulable_probe_does_not_replace_controller(self):
        for failure in ("create", "wait"):
            with self.subTest(failure=failure):
                run = FakeKubectl(fail=failure)
                with self.assertRaises(RuntimeError):
                    module.deploy(run, "controller", "controller", IMAGE, "check")
                verbs = [args[0] for args, _ in run.calls]
                self.assertNotIn("patch", verbs)
                self.assertNotIn("rollout", verbs)
                self.assertIn("delete", verbs)

    def test_cleanup_failure_does_not_mask_pull_failure(self):
        run = FakeKubectl()

        def fail(*args, **kwargs):
            run(*args, **kwargs)
            if args[0] in ("wait", "delete"):
                raise RuntimeError(args[0])
            return json.dumps(DEPLOYMENT) if args[:2] == ("get", "deployment") else '{"items":[]}'

        with self.assertRaisesRegex(RuntimeError, "^wait$"):
            module.deploy(fail, "controller", "controller", IMAGE, "check")

    def test_rollout_failure_is_reported(self):
        with self.assertRaisesRegex(RuntimeError, "rollout failed"):
            module.deploy(FakeKubectl(fail="rollout"), "controller", "controller", IMAGE, "check")

    def test_mutable_or_local_images_are_rejected_before_cluster_access(self):
        for image in ("", "pulpo-workspace-controller:main", "ghcr.io/example/controller:main", IMAGE[:-1]):
            with self.subTest(image=image):
                run = FakeKubectl()
                with self.assertRaises(ValueError):
                    module.deploy(run, "controller", "controller", image, "check")
                self.assertEqual(run.calls, [])


if __name__ == "__main__":
    unittest.main()
