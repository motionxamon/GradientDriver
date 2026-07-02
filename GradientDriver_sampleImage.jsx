/*
GradientDriver.jsx
Apply sampleImage-driven gradient control to selected After Effects properties.
Black drives each property to its Min control, white drives it to its Max control.
*/

(function gradientDriver() {
    var SCRIPT_NAME = "Gradient Driver";
    var CTRL_NAME = "Driver Control";
    var GRADIENT_NAME = "Driver Gradient Source";
    var START_NAME = "Start Driver";
    var END_NAME = "End Driver";
    var SAMPLE_RADIUS = 2;

    function activeComp() {
        var item = app.project.activeItem;
        if (!(item instanceof CompItem)) {
            throw new Error("Open a composition first.");
        }
        return item;
    }

    function applyGradientDriver(comp) {
        var props = selectedWritableProperties(comp);
        if (props.length < 1) {
            throw new Error("Select one or more properties that can use expressions.");
        }

        var handles = createGradientHandles(comp);
        var gradient = createGradientLayer(comp, handles.start, handles.end);
        var ctrl = createController(comp);
        var controlGroups = {};
        var groupCount = 0;

        for (var i = 0; i < props.length; i++) {
            var prop = props[i];
            var info = propertyInfo(prop);
            var groupKey = controlGroupKey(info);
            var names = controlGroups[groupKey];
            if (!names) {
                groupCount++;
                names = addMinMaxControls(ctrl, info, groupCount);
                controlGroups[groupKey] = names;
            }
            prop.expression = driverExpression(ctrl.name, gradient.name, names.min, names.max, info);
            markOwningLayer(prop, 10);
        }
        ctrl.moveBefore(handles.start);
        gradient.moveToEnd();
    }

    function selectedWritableProperties(comp) {
        var out = [];
        var selected = comp.selectedProperties;
        for (var i = 0; i < selected.length; i++) {
            var prop = selected[i];
            if (prop instanceof Property && prop.canSetExpression && isSupportedProperty(prop)) {
                out.push(prop);
            }
        }
        return out;
    }

    function isSupportedProperty(prop) {
        var t = prop.propertyValueType;
        return t === PropertyValueType.OneD ||
            t === PropertyValueType.TwoD ||
            t === PropertyValueType.TwoD_SPATIAL ||
            t === PropertyValueType.ThreeD ||
            t === PropertyValueType.ThreeD_SPATIAL ||
            t === PropertyValueType.COLOR;
    }

    function propertyInfo(prop) {
        var value = prop.value;
        var t = prop.propertyValueType;
        var name = cleanName(prop.name);

        if (isScaleProperty(prop)) {
            return scalePropertyInfo(prop, value, name);
        }

        if (t === PropertyValueType.COLOR) {
            return {
                name: name,
                kind: "color",
                accessor: "Color",
                min: [0, 0, 0, value.length > 3 ? value[3] : 1],
                max: [1, 1, 1, value.length > 3 ? value[3] : 1],
                output: "normal",
                groupName: "Color"
            };
        }

        if (t === PropertyValueType.TwoD || t === PropertyValueType.TwoD_SPATIAL) {
            return {
                name: name,
                kind: "point",
                accessor: "Point",
                min: offsetArray(value, -100),
                max: offsetArray(value, 100),
                output: "normal",
                groupName: name
            };
        }

        if (t === PropertyValueType.ThreeD || t === PropertyValueType.ThreeD_SPATIAL) {
            return {
                name: name,
                kind: "point",
                accessor: "Point",
                min: offsetArray(value, -100),
                max: offsetArray(value, 100),
                output: "point3d",
                zValue: value.length > 2 ? value[2] : 0,
                groupName: name
            };
        }

        var isAngle = looksLikeAngle(prop);
        return {
            name: name,
            kind: isAngle ? "angle" : "slider",
            accessor: isAngle ? "Angle" : "Slider",
            min: isAngle ? value - 45 : defaultScalarMin(prop, value),
            max: isAngle ? value + 45 : defaultScalarMax(prop, value),
            output: "normal",
            groupName: name
        };
    }

    function isScaleProperty(prop) {
        var n = String(prop.name).toLowerCase();
        var m = String(prop.matchName).toLowerCase();
        return n === "scale" || m.indexOf("scale") !== -1;
    }

    function scalePropertyInfo(prop, value, name) {
        var z = value.length > 2 ? value[2] : 100;
        var proportional = value.length < 2 || Math.abs(value[0] - value[1]) < 0.001;
        if (proportional) {
            return {
                name: name,
                kind: "slider",
                accessor: "Slider",
                min: value[0] * 0.5,
                max: value[0] * 1.5,
                output: value.length > 2 ? "scaleUniform3d" : "scaleUniform2d",
                zValue: z,
                groupName: "Scale"
            };
        }
        return {
            name: name,
            kind: "point",
            accessor: "Point",
            min: [value[0] * 0.5, value[1] * 0.5],
            max: [value[0] * 1.5, value[1] * 1.5],
            output: value.length > 2 ? "scalePoint3d" : "normal",
            zValue: z,
            groupName: "Scale XY"
        };
    }

    function looksLikeAngle(prop) {
        var n = String(prop.name).toLowerCase();
        var m = String(prop.matchName).toLowerCase();
        return n.indexOf("rotation") !== -1 ||
            n.indexOf("angle") !== -1 ||
            m.indexOf("rotate") !== -1 ||
            m.indexOf("rotation") !== -1;
    }

    function defaultScalarMin(prop, value) {
        var n = String(prop.name).toLowerCase();
        if (n.indexOf("opacity") !== -1) {
            return 0;
        }
        if (value === 0) {
            return -100;
        }
        return value * 0.5;
    }

    function defaultScalarMax(prop, value) {
        var n = String(prop.name).toLowerCase();
        if (n.indexOf("opacity") !== -1) {
            return 100;
        }
        if (value === 0) {
            return 100;
        }
        return value * 1.5;
    }

    function offsetArray(value, amount) {
        var out = [];
        var limit = Math.min(value.length, 2);
        for (var i = 0; i < limit; i++) {
            out.push(value[i] + amount);
        }
        return out;
    }

    function createController(comp) {
        var ctrl = comp.layers.addNull();
        ctrl.name = uniqueName(comp, CTRL_NAME);
        ctrl.label = 1;
        ctrl.guideLayer = true;
        var transform = ctrl.property("ADBE Transform Group");
        transform.property("ADBE Anchor Point").setValue([50, 50]);
        transform.property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
        transform.property("ADBE Scale").setValue([0, 0]);
        return ctrl;
    }

    function createGradientHandles(comp) {
        var start = comp.layers.addNull();
        start.name = uniqueName(comp, START_NAME);
        start.label = 13;
        start.guideLayer = true;
        start.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([50, 50]);
        start.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width / 2, comp.height / 2]);
        start.property("ADBE Transform Group").property("ADBE Scale").setValue([200, 200]);

        var end = comp.layers.addNull();
        end.name = uniqueName(comp, END_NAME);
        end.label = 14;
        end.guideLayer = true;
        end.property("ADBE Transform Group").property("ADBE Anchor Point").setValue([50, 50]);
        end.property("ADBE Transform Group").property("ADBE Position").setValue([comp.width * 0.82, comp.height / 2]);
        end.property("ADBE Transform Group").property("ADBE Scale").setValue([200, 200]);

        start.moveBefore(end);
        return { start: start, end: end };
    }

    function createGradientLayer(comp, startHandle, endHandle) {
        var layer = comp.layers.addSolid([1, 1, 1], uniqueName(comp, GRADIENT_NAME), comp.width, comp.height, comp.pixelAspect, comp.duration);
        layer.label = 11;
        layer.guideLayer = true;
        layer.shy = true;

        var opacity = layer.property("ADBE Transform Group").property("ADBE Opacity");
        opacity.setValue(100);

        var fx = layer.property("ADBE Effect Parade");
        var ramp = fx.addProperty("ADBE Ramp");
        ramp.name = "Gradient Driver Ramp";
        try {
            ramp.property(1).setValue([comp.width / 2, comp.height / 2]);
            ramp.property(2).setValue([0, 0, 0]);
            ramp.property(3).setValue([comp.width * 0.82, comp.height / 2]);
            ramp.property(4).setValue([1, 1, 1]);
            if (ramp.property(5)) {
                ramp.property(5).setValue(2);
            }
            ramp.property(1).expression = 'thisComp.layer("' + escapeName(startHandle.name) + '").toComp(thisComp.layer("' + escapeName(startHandle.name) + '").anchorPoint);';
            ramp.property(3).expression = 'thisComp.layer("' + escapeName(endHandle.name) + '").toComp(thisComp.layer("' + escapeName(endHandle.name) + '").anchorPoint);';
        } catch (err) {}
        return layer;
    }

    function addMinMaxControls(ctrl, info, index) {
        var base = padNumber(index, 2) + " " + info.groupName;
        var minName = uniqueEffectName(ctrl, "Min " + base);
        var maxName = uniqueEffectName(ctrl, "Max " + base);

        setControlValue(addControl(ctrl, info.kind, minName), info.min);
        setControlValue(addControl(ctrl, info.kind, maxName), info.max);

        return { min: minName, max: maxName };
    }

    function controlGroupKey(info) {
        var semantic = info.groupName;
        if (semantic !== "Scale" && semantic !== "Scale XY") {
            semantic = info.name;
        }
        return [
            semantic,
            info.kind,
            info.accessor,
            info.output || "normal",
            roundedValueKey(info.min),
            roundedValueKey(info.max)
        ].join("|");
    }

    function roundedValueKey(value) {
        if (value instanceof Array) {
            var out = [];
            for (var i = 0; i < value.length; i++) {
                out.push(roundForKey(value[i]));
            }
            return out.join(",");
        }
        return String(roundForKey(value));
    }

    function roundForKey(value) {
        var n = parseFloat(value);
        if (isNaN(n)) {
            return value;
        }
        return Math.round(n * 1000) / 1000;
    }

    function addControl(layer, kind, name) {
        var fx = layer.property("ADBE Effect Parade");
        var matchName = "ADBE Slider Control";
        if (kind === "angle") {
            matchName = "ADBE Angle Control";
        } else if (kind === "point") {
            matchName = "ADBE Point Control";
        } else if (kind === "color") {
            matchName = "ADBE Color Control";
        }
        var prop = fx.addProperty(matchName);
        prop.name = name;
        return prop;
    }

    function setControlValue(effect, value) {
        try {
            effect.property(1).setValue(value);
        } catch (err) {}
    }

    function driverExpression(ctrlName, gradientName, minName, maxName, info) {
        var base = '' +
            'ctrl=thisComp.layer("' + escapeName(ctrlName) + '");\n' +
            'grad=thisComp.layer("' + escapeName(gradientName) + '");\n' +
            'p=grad.fromComp(thisLayer.toComp(anchorPoint));\n' +
            'c=grad.sampleImage(p,[' + SAMPLE_RADIUS + ',' + SAMPLE_RADIUS + '],true,time);\n' +
            'luma=clamp((c[0]+c[1]+c[2])/3,0,1);\n' +
            'mn=ctrl.effect("' + escapeName(minName) + '")("' + info.accessor + '");\n' +
            'mx=ctrl.effect("' + escapeName(maxName) + '")("' + info.accessor + '");\n' +
            'v=linear(luma,0,1,mn,mx);\n';

        if (info.output === "scaleUniform2d") {
            return base + '[v,v];';
        }
        if (info.output === "scaleUniform3d") {
            return base + '[v,v,' + numberLiteral(info.zValue) + '];';
        }
        if (info.output === "scalePoint3d" || info.output === "point3d") {
            return base + '[v[0],v[1],' + numberLiteral(info.zValue) + '];';
        }
        return base + 'v;';
    }

    function markOwningLayer(prop, label) {
        var owner = owningLayer(prop);
        if (owner) {
            try {
                owner.label = label;
            } catch (err) {}
        }
    }

    function owningLayer(prop) {
        var p = prop;
        while (p && !isLayerObject(p)) {
            p = p.parentProperty;
        }
        return p;
    }

    function isLayerObject(obj) {
        if (typeof AVLayer !== "undefined" && obj instanceof AVLayer) {
            return true;
        }
        if (typeof CameraLayer !== "undefined" && obj instanceof CameraLayer) {
            return true;
        }
        if (typeof LightLayer !== "undefined" && obj instanceof LightLayer) {
            return true;
        }
        return obj && obj.property && obj.containingComp;
    }

    function uniqueName(comp, base) {
        var name = base;
        var n = 2;
        while (layerByName(comp, name) !== null) {
            name = base + " " + n;
            n++;
        }
        return name;
    }

    function layerByName(comp, name) {
        try {
            return comp.layer(name);
        } catch (err) {
            return null;
        }
    }

    function uniqueEffectName(layer, base) {
        var fx = layer.property("ADBE Effect Parade");
        var name = base;
        var n = 2;
        while (fx.property(name)) {
            name = base + " " + n;
            n++;
        }
        return name;
    }

    function cleanName(name) {
        return String(name).replace(/[\\"]/g, "").replace(/\s+/g, " ").substr(0, 36);
    }

    function escapeName(name) {
        return String(name).replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
    }

    function numberLiteral(value) {
        var n = parseFloat(value);
        return isNaN(n) ? "0" : String(n);
    }

    function padNumber(n, width) {
        var s = String(n);
        while (s.length < width) {
            s = "0" + s;
        }
        return s;
    }

    app.beginUndoGroup(SCRIPT_NAME);
    try {
        applyGradientDriver(activeComp());
    } catch (err) {
        alert(err.toString());
    } finally {
        app.endUndoGroup();
    }
})();
