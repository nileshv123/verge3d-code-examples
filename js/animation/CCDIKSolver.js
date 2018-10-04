/**
 * @author takahiro / https://github.com/takahirox
 *
 * CCD Algorithm
 *  https://sites.google.com/site/auraliusproject/ccd-algorithm
 *
 * mesh.geometry needs to have iks array.
 *
 * // ik parameter example
 * //
 * // target, effector, index in links are bone index in skeleton.
 * // the bones relation should be
 * // <-- parent                                  child -->
 * // links[n], links[n - 1], ..., links[0], effector
 * ik = {
 *    target: 1,
 *    effector: 2,
 *    links: [{ index: 5, limitation: new v3d.Vector3(1, 0, 0) }, { index: 4, enabled: false }, { index : 3 }],
 *    iteration: 10,
 *    minAngle: 0.0,
 *    maxAngle: 1.0,
 * };
 */

v3d.CCDIKSolver = function(mesh) {

    this.mesh = mesh;

    this._valid();

};

v3d.CCDIKSolver.prototype = {

    constructor: v3d.CCDIKSolver,

    _valid: function() {

        var iks = this.mesh.geometry.iks;
        var bones = this.mesh.skeleton.bones;

        for (var i = 0, il = iks.length; i < il; i++) {

            var ik = iks[i];

            var effector = bones[ik.effector];

            var links = ik.links;

            var link0, link1;

            link0 = effector;

            for (var j = 0, jl = links.length; j < jl; j ++) {

                link1 = bones[links[j].index];

                if (link0.parent !== link1) {

                    console.warn('v3d.CCDIKSolver: bone ' + link0.name + ' is not the child of bone ' + link1.name);

                }

                link0 = link1;

            }

        }

    },

    /*
     * save the bone matrices before solving IK.
     * they're used for generating VMD and VPD.
     */
    _saveOriginalBonesInfo: function() {

        var bones = this.mesh.skeleton.bones;

        for (var i = 0, il = bones.length; i < il; i++) {

            var bone = bones[i];

            if (bone.userData.ik === undefined) bone.userData.ik = {};

            bone.userData.ik.originalMatrix = bone.matrix.toArray();

        }

    },

    update: function(saveOriginalBones) {

        var q = new v3d.Quaternion();

        var targetPos = new v3d.Vector3();
        var targetVec = new v3d.Vector3();
        var effectorPos = new v3d.Vector3();
        var effectorVec = new v3d.Vector3();
        var linkPos = new v3d.Vector3();
        var invLinkQ = new v3d.Quaternion();
        var linkScale = new v3d.Vector3();
        var axis = new v3d.Vector3();

        var bones = this.mesh.skeleton.bones;
        var iks = this.mesh.geometry.iks;

        var boneParams = this.mesh.geometry.bones;

        // for reference overhead reduction in loop
        var math = Math;

        this.mesh.updateMatrixWorld(true);

        if (saveOriginalBones === true) this._saveOriginalBonesInfo();

        for (var i = 0, il = iks.length; i < il; i++) {

            var ik = iks[i];
            var effector = bones[ik.effector];
            var target = bones[ik.target];

            // don't use getWorldPosition() here for the performance
            // because it calls updateMatrixWorld(true) inside.
            targetPos.setFromMatrixPosition(target.matrixWorld);

            var links = ik.links;
            var iteration = ik.iteration !== undefined ? ik.iteration : 1;

            for (var j = 0; j < iteration; j++) {

                var rotated = false;

                for (var k = 0, kl = links.length; k < kl; k++) {

                    var link = bones[links[k].index];

                    // skip this link and following links.
                    // this skip is used for MMD performance optimization.
                    if (links[k].enabled === false) break;

                    var limitation = links[k].limitation;

                    // don't use getWorldPosition/Quaternion() here for the performance
                    // because they call updateMatrixWorld(true) inside.
                    link.matrixWorld.decompose(linkPos, invLinkQ, linkScale);
                    invLinkQ.inverse();
                    effectorPos.setFromMatrixPosition(effector.matrixWorld);

                    // work in link world
                    effectorVec.subVectors(effectorPos, linkPos);
                    effectorVec.applyQuaternion(invLinkQ);
                    effectorVec.normalize();

                    targetVec.subVectors(targetPos, linkPos);
                    targetVec.applyQuaternion(invLinkQ);
                    targetVec.normalize();

                    var angle = targetVec.dot(effectorVec);

                    if (angle > 1.0) {

                        angle = 1.0;

                    } else if (angle < -1.0) {

                        angle = -1.0;

                    }

                    angle = math.acos(angle);

                    // skip if changing angle is too small to prevent vibration of bone
                    // Refer to http://www20.atpages.jp/katwat/three.js_r58/examples/mytest37/mmd.three.js
                    if (angle < 1e-5) continue;

                    if (ik.minAngle !== undefined && angle < ik.minAngle) {

                        angle = ik.minAngle;

                    }

                    if (ik.maxAngle !== undefined && angle > ik.maxAngle) {

                        angle = ik.maxAngle;

                    }

                    axis.crossVectors(effectorVec, targetVec);
                    axis.normalize();

                    q.setFromAxisAngle(axis, angle);
                    link.quaternion.multiply(q);

                    // TODO: re-consider the limitation specification
                    if (limitation !== undefined) {

                        var c = link.quaternion.w;

                        if (c > 1.0) {

                            c = 1.0;

                        }

                        var c2 = math.sqrt(1 - c * c);
                        link.quaternion.set(limitation.x * c2,
                                             limitation.y * c2,
                                             limitation.z * c2,
                                             c);

                    }

                    link.updateMatrixWorld(true);
                    rotated = true;

                }

                if (! rotated) break;

            }

        }

        // just in case
        this.mesh.updateMatrixWorld(true);

    }

};


v3d.CCDIKHelper = function(mesh) {

    if (mesh.geometry.iks === undefined || mesh.skeleton === undefined) {

        throw 'v3d.CCDIKHelper requires iks in mesh.geometry and skeleton in mesh.';

    }

    v3d.Object3D.call(this);

    this.root = mesh;

    this.matrix = mesh.matrixWorld;
    this.matrixAutoUpdate = false;

    this.sphereGeometry = new v3d.SphereBufferGeometry(0.25, 16, 8);

    this.targetSphereMaterial = new v3d.MeshBasicMaterial({
        color: new v3d.Color(0xff8888),
        depthTest: false,
        depthWrite: false,
        transparent: true
    });

    this.effectorSphereMaterial = new v3d.MeshBasicMaterial({
        color: new v3d.Color(0x88ff88),
        depthTest: false,
        depthWrite: false,
        transparent: true
    });

    this.linkSphereMaterial = new v3d.MeshBasicMaterial({
        color: new v3d.Color(0x8888ff),
        depthTest: false,
        depthWrite: false,
        transparent: true
    });

    this.lineMaterial = new v3d.LineBasicMaterial({
        color: new v3d.Color(0xff0000),
        depthTest: false,
        depthWrite: false,
        transparent: true
    });

    this._init();
    this.update();

};

v3d.CCDIKHelper.prototype = Object.create(v3d.Object3D.prototype);
v3d.CCDIKHelper.prototype.constructor = v3d.CCDIKHelper;

v3d.CCDIKHelper.prototype._init = function() {

    var self = this;
    var mesh = this.root;
    var iks = mesh.geometry.iks;

    function createLineGeometry(ik) {

        var geometry = new v3d.BufferGeometry();
        var vertices = new Float32Array((2 + ik.links.length) * 3);
        geometry.addAttribute('position', new v3d.BufferAttribute(vertices, 3));

        return geometry;

    }

    function createTargetMesh() {

        return new v3d.Mesh(self.sphereGeometry, self.targetSphereMaterial);

    }

    function createEffectorMesh() {

        return new v3d.Mesh(self.sphereGeometry, self.effectorSphereMaterial);

    }

    function createLinkMesh() {

        return new v3d.Mesh(self.sphereGeometry, self.linkSphereMaterial);

    }

    function createLine(ik) {

        return new v3d.Line(createLineGeometry(ik), self.lineMaterial);

    }

    for (var i = 0, il = iks.length; i < il; i++) {

        var ik = iks[i];

        this.add(createTargetMesh());
        this.add(createEffectorMesh());

        for (var j = 0, jl = ik.links.length; j < jl; j ++) {

            this.add(createLinkMesh());

        }

        this.add(createLine(ik));

    }

};

v3d.CCDIKHelper.prototype.update = function() {

    var offset = 0;

    var mesh = this.root;
    var iks = mesh.geometry.iks;
    var bones = mesh.skeleton.bones;

    var matrixWorldInv = new v3d.Matrix4().getInverse(mesh.matrixWorld);
    var vector = new v3d.Vector3();

    function getPosition(bone) {

        vector.setFromMatrixPosition(bone.matrixWorld);
        vector.applyMatrix4(matrixWorldInv);

        return vector;

    }

    function setPositionOfBoneToAttributeArray(array, index, bone) {

        var v = getPosition(bone);

        array[index * 3 + 0] = v.x;
        array[index * 3 + 1] = v.y;
        array[index * 3 + 2] = v.z;

    }

    for (var i = 0, il = iks.length; i < il; i++) {

        var ik = iks[i];

        var targetBone = bones[ik.target];
        var effectorBone = bones[ik.effector];

        var targetMesh = this.children[offset ++];
        var effectorMesh = this.children[offset ++];

        targetMesh.position.copy(getPosition(targetBone));
        effectorMesh.position.copy(getPosition(effectorBone));

        for (var j = 0, jl = ik.links.length; j < jl; j ++) {

            var link = ik.links[j];
            var linkBone = bones[link.index];

            var linkMesh = this.children[offset ++];

            linkMesh.position.copy(getPosition(linkBone));

        }

        var line = this.children[offset ++];
        var array = line.geometry.attributes.position.array;

        setPositionOfBoneToAttributeArray(array, 0, targetBone);
        setPositionOfBoneToAttributeArray(array, 1, effectorBone);

        for (var j = 0, jl = ik.links.length; j < jl; j ++) {

            var link = ik.links[j];
            var linkBone = bones[link.index];
            setPositionOfBoneToAttributeArray(array, j + 2, linkBone);

        }

        line.geometry.attributes.position.needsUpdate = true;

    }

};